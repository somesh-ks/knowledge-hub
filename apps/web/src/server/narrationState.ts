import { stockholmDate, TIME_ZONE, UsageFile } from "@singularity/core";
import { type BudgetRefusal, checkBudget, emptyUsage } from "@singularity/engine/audio";
import { z } from "zod";

/**
 * The one document the narrate function keeps per month: state/usage-<YYYY-MM>.json. It holds the
 * month's character total and every digest narrated this month, with the day it was first narrated,
 * the characters it was charged, the voice, and which way it was narrated. The monthly budget and
 * the daily cap are both read from it.
 *
 * A digest is charged in full and ahead of time: the first request to narrate any part of it, one
 * segment or the whole, charges its entire spoken text before a single character is synthesized.
 * Every later segment of that digest finds the charge and writes nothing.
 *
 * It is charged in full AGAIN whenever Speechify is about to read text it has already been paid to
 * read: when the voice has changed (every segment gets a new file), and when the digest is narrated
 * as one file after it was narrated in segments, or the other way round. And each attempt that
 * reached Speechify and then failed adds that attempt's characters (`addRepeat`), which pays for
 * the retry that follows.
 *
 * All of that is deliberately pessimistic. A briefing the listener abandons after the intro is
 * charged whole, and a failure nobody retries is charged twice. The counter must never read below
 * what Speechify actually billed, because the counter is what stops the function before the
 * account's hard limit does; reading above it only makes the function stop a little early.
 *
 * It is also what keeps the store cheap: one write per digest per month in the ordinary case,
 * instead of one or two for every segment.
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
  /** The length of the spoken text this digest was last charged for. */
  characters: z.number().int().nonnegative(),
  /** The voice it was charged for. Another voice means every file is made again. */
  voice: z.string().min(1).optional(),
  /** Charged for being narrated as one file. */
  whole: z.boolean().optional(),
  /** Charged for being narrated in segments. */
  segments: z.boolean().optional(),
  /** Characters added on top for attempts that failed after reaching Speechify. */
  repeats: z.number().int().nonnegative().optional(),
});
type DigestCharge = z.infer<typeof DigestCharge>;

/** The engine's usage file plus the digests behind the total, so the engine's budget rules apply to it as it is. */
export const NarrationState = UsageFile.extend({
  digests: z.record(z.string(), DigestCharge).default({}),
});
export type NarrationState = z.infer<typeof NarrationState>;

/** The two ways a digest is narrated. Each is paid for separately. */
export type NarrationMode = "whole" | "segments";

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
  /** The digest is already charged for this. Nothing to write. */
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
  /** The voice that will read it. */
  voice: string;
  /** Whether this request narrates the whole digest as one file, or one segment of it. */
  mode: NarrationMode;
  now: number;
  monthlyChars: number;
  dailyCap: number;
}

/**
 * What narrating this digest costs now.
 *
 * - Not yet charged this month: the whole text, if a place is free under today's cap (digests first
 *   narrated today) and the month's budget has room for all of it.
 * - Charged for another voice, or only for the other way of narrating it: the whole text again.
 * - Charged, and the text has since grown: the difference.
 * - Otherwise nothing.
 *
 * A digest that is already in the document has its day, so the daily cap does not apply to it again.
 * An entry written before voices were recorded is taken to be in the current voice.
 */
export function planCharge(input: ChargeInput): ChargePlan {
  const { state, digest, characters, voice, mode, now } = input;
  const today = stockholmDate(new Date(now));
  const charged = state.digests[digest];

  const newVoice = charged !== undefined && (charged.voice ?? voice) !== voice;
  const otherModeOnly =
    charged !== undefined &&
    (mode === "whole"
      ? charged.segments === true && charged.whole !== true
      : charged.whole === true && charged.segments !== true);
  const again = newVoice || otherModeOnly;
  const owed =
    charged === undefined || again ? characters : Math.max(0, characters - charged.characters);
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

  // A new voice starts over: only this way of narrating has been paid for in it.
  const paidBefore = charged && !newVoice ? charged : undefined;
  const entry: DigestCharge = {
    day: charged?.day ?? today,
    characters: Math.max(characters, paidBefore?.characters ?? 0),
    voice,
    whole: mode === "whole" || paidBefore?.whole === true,
    segments: mode === "segments" || paidBefore?.segments === true,
    ...(charged?.repeats ? { repeats: charged.repeats } : {}),
  };
  return {
    kind: "charge",
    added: owed,
    next: {
      version: 1,
      speechify: {
        month: state.speechify.month,
        characters: state.speechify.characters + owed,
      },
      digests: { ...state.digests, [digest]: entry },
    },
  };
}

/**
 * Adds the characters of an attempt that reached Speechify and then failed. The digest's charge
 * covered that attempt; this covers the retry that will ask Speechify for the same text again. No
 * budget check: it records spending, it does not ask leave for it.
 */
export function addRepeat(
  state: NarrationState,
  digest: string,
  characters: number,
  now: number,
): NarrationState {
  const added = Math.max(0, Math.round(characters));
  const charged = state.digests[digest];
  const entry: DigestCharge = {
    ...(charged ?? { day: stockholmDate(new Date(now)), characters: 0 }),
    repeats: (charged?.repeats ?? 0) + added,
  };
  return {
    version: 1,
    speechify: {
      month: state.speechify.month,
      characters: state.speechify.characters + added,
    },
    digests: { ...state.digests, [digest]: entry },
  };
}
