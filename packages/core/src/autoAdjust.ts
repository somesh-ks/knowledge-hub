import { z } from "zod";

/**
 * Every number that decides how far story votes move a source's score, in one place. First guesses:
 * tune them against real votes. Votes no longer move a topic's weight (D193); a source's adjustment
 * is stored beside the source and added at scoring time.
 */
export const AUTO_ADJUST = {
  /** Largest adjustment either way, on the 0 to 1 score scale. */
  max: 0.2,
  /** What one vote moves an adjustment, before the bound. Ten net votes reach the bound. */
  step: 0.02,
  /** An adjustment halves after this many days without a vote, so one bad week does not dominate. */
  half_life_days: 30,
  /** Below this the adjustment is shown as none and counted as none. */
  min_shown: 0.005,
  /** A source's adjustment moves its items' score by this share of itself (at most 0.05). */
  source_scale: 0.25,
} as const;

const DAY_MS = 86_400_000;

/** One stored adjustment: its value when last changed, and when. */
export const AdjustEntry = z.object({ value: z.number(), at: z.string().min(1) });
export type AdjustEntry = z.infer<typeof AdjustEntry>;

/** An older document may still carry `topics`; it is stripped on parse and never read. */
export const AutoAdjust = z.object({
  sources: z.record(z.string(), AdjustEntry).default({}),
});
export type AutoAdjust = z.infer<typeof AutoAdjust>;

export const emptyAutoAdjust = (): AutoAdjust => ({ sources: {} });

const bound = (n: number): number => Math.max(-AUTO_ADJUST.max, Math.min(AUTO_ADJUST.max, n));
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** An entry's value at `now`: halved for every half-life since it was last changed. */
export function adjustmentAt(entry: AdjustEntry | undefined, now: Date): number {
  if (!entry) return 0;
  const age = Math.max(0, now.getTime() - Date.parse(entry.at));
  if (Number.isNaN(age)) return 0;
  const value = bound(entry.value) * 0.5 ** (age / DAY_MS / AUTO_ADJUST.half_life_days);
  return Math.abs(value) < AUTO_ADJUST.min_shown ? 0 : round4(value);
}

/** The entry after `votes` net votes (positive up, negative down) cast at `at`. */
export function nudgeEntry(entry: AdjustEntry | undefined, votes: number, at: string): AdjustEntry {
  const base = adjustmentAt(entry, new Date(at));
  return { value: round4(bound(base + votes * AUTO_ADJUST.step)), at };
}

/** The score change for an item of a source with this adjustment. */
export function sourceShift(adjustment: number): number {
  return round4(adjustment * AUTO_ADJUST.source_scale);
}

/** A vote as the adjustment loop reads it. */
export interface AdjustVote {
  story_id: string;
  topic: string;
  source_id: string;
  value: "up" | "down" | "clear";
  at: string;
}

/**
 * The adjustments after `incoming` votes are applied over the `stored` ones: a new vote moves its
 * source one step, a changed vote undoes the old one first, a repeat of the same vote
 * does nothing, and a clear undoes it. Pure; the caller writes.
 */
export function applyVotes(
  current: AutoAdjust,
  stored: readonly { story_id: string; value: "up" | "down" }[],
  incoming: readonly AdjustVote[],
): AutoAdjust {
  const prior = new Map(stored.map((vote) => [vote.story_id, vote.value]));
  const next: AutoAdjust = { sources: { ...current.sources } };
  const sign = (value: "up" | "down"): number => (value === "up" ? 1 : -1);
  for (const vote of incoming) {
    const before = prior.get(vote.story_id);
    if (before === vote.value) continue;
    const net = (vote.value === "clear" ? 0 : sign(vote.value)) - (before ? sign(before) : 0);
    if (net === 0) continue;
    next.sources[vote.source_id] = nudgeEntry(next.sources[vote.source_id], net, vote.at);
    if (vote.value === "clear") prior.delete(vote.story_id);
    else prior.set(vote.story_id, vote.value);
  }
  return next;
}
