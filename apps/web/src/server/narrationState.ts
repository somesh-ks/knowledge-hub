import { stockholmDate, TIME_ZONE, UsageFile } from "@dispatch/core";
import { type BudgetRefusal, checkBudget, emptyUsage } from "@dispatch/engine/audio";
import { z } from "zod";

/**
 * The one document the narrate function keeps per month: state/usage-<YYYY-MM>.json. It holds the
 * month's character total and every digest narrated this month, with the day it was first narrated
 * and the characters it was charged. The monthly budget and the daily cap are both read from it.
 *
 * A digest is charged ONCE, and in full: the first request to narrate any part of it, one segment or
 * the whole, charges its entire spoken text before a single character is synthesized. Every later
 * segment of that digest finds the charge and writes nothing.
 *
 * That is deliberately pessimistic. A briefing the listener abandons after the intro is still
 * charged whole, and a synthesis that fails or times out is still charged. The counter must never
 * read below what Speechify actually billed, because the counter is what stops the function before
 * the account's hard limit does; reading above it only makes the function stop a little early.
 *
 * It is also what keeps the store cheap: one write per digest per month, instead of one or two for
 * every segment.
 *
 * Writing it is read, change, write. Two requests for the same digest write the same charge, so
 * nothing is lost. Two requests for different digests that land in the same moment can lose one of
 * the two charges; the page narrates one thing at a time, and the budget stops at 90 percent of the
 * allowance, which leaves room for that.
 */

/** One counter per Stockholm month, YYYY-MM. */
export const usageKey = (month: string): string => `state/usage-${month}.json`;

const DigestCharge = z.object({
  /** Stockholm date of the first narration, YYYY-MM-DD. The daily cap counts these. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Characters this digest has been charged so far. */
  characters: z.number().int().nonnegative(),
});

/** The engine's usage file plus the digests behind the total, so the engine's budget rules apply to it as it is. */
export const NarrationState = UsageFile.extend({
  digests: z.record(z.string(), DigestCharge).default({}),
});
export type NarrationState = z.infer<typeof NarrationState>;

export function emptyState(month: string): NarrationState {
  return { ...emptyUsage(month), digests: {} };
}

/**
 * The state for `month` from the stored text. Nothing stored is an empty month. Text that cannot be
 * read is an error, never an empty month: that would switch the budget and the cap off.
 */
export function parseState(text: string | null, month: string): NarrationState {
  if (text === null) return emptyState(month);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${usageKey(month)} is not valid JSON`);
  }
  const parsed = NarrationState.safeParse(raw);
  if (!parsed.success || parsed.data.speechify.month !== month) {
    throw new Error(`${usageKey(month)} is not a valid usage document`);
  }
  return parsed.data;
}

export function serializeState(state: NarrationState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Seconds until the Stockholm calendar day ends. Off by an hour on the two days the clocks change. */
export function secondsUntilNextDay(now: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const elapsed = read("hour") * 3600 + read("minute") * 60 + read("second");
  return Math.max(1, 24 * 3600 - elapsed);
}

export type ChargePlan =
  /** The digest is already charged for at least this much. Nothing to write. */
  | { kind: "covered" }
  /** Write `next` before synthesizing anything. */
  | { kind: "charge"; added: number; next: NarrationState }
  | { kind: "daily_cap"; retryAfterSeconds: number }
  | { kind: "monthly_budget"; refusal: BudgetRefusal };

export interface ChargeInput {
  state: NarrationState;
  digest: string;
  /** The length of the digest's whole spoken text, whatever part of it is being narrated. */
  characters: number;
  now: number;
  monthlyChars: number;
  dailyCap: number;
}

/**
 * What narrating this digest costs now.
 *
 * - Not yet charged this month: the whole text, if a place is free under today's cap (digests first
 *   narrated today) and the month's budget has room for all of it.
 * - Charged, and the text has since grown: the difference. It already has its day, so the daily cap
 *   does not apply again.
 * - Charged for this much or more: nothing.
 */
export function planCharge(input: ChargeInput): ChargePlan {
  const { state, digest, characters, now } = input;
  const today = stockholmDate(new Date(now));
  const charged = state.digests[digest];
  const owed = Math.max(0, characters - (charged?.characters ?? 0));
  if (owed === 0) return { kind: "covered" };

  if (!charged) {
    const narratedToday = Object.values(state.digests).filter((entry) => entry.day === today);
    if (narratedToday.length >= input.dailyCap) {
      return { kind: "daily_cap", retryAfterSeconds: secondsUntilNextDay(now) };
    }
  }

  const budget = checkBudget({
    usage: state,
    now: new Date(now),
    requested: owed,
    monthlyChars: input.monthlyChars,
  });
  if (!budget.ok) return { kind: "monthly_budget", refusal: budget };

  return {
    kind: "charge",
    added: owed,
    next: {
      version: 1,
      speechify: {
        month: state.speechify.month,
        characters: state.speechify.characters + owed,
      },
      digests: { ...state.digests, [digest]: { day: charged?.day ?? today, characters } },
    },
  };
}
