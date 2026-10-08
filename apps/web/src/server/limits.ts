/**
 * Rate limits for the Generate button, computed from the workflow runs GitHub already lists, so the
 * function keeps no state of its own. One on-demand run per 6 hours and three per 24 hours. The count
 * includes every workflow_dispatch run of run.yml, whoever started it (build plan 8.9).
 */
export const COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_CAP = 3;

/** A cooldown between runs and a cap on runs in 24 hours. */
export interface LimitPolicy {
  cooldownMs: number;
  dailyCap: number;
}

const BRIEFING_POLICY: LimitPolicy = { cooldownMs: COOLDOWN_MS, dailyCap: DAILY_CAP };

/**
 * Episodes of the Create page: two a day, and half an hour apart so one tap cannot queue two. Counted
 * over the runs of podcast.yml, apart from the briefings.
 */
export const PODCAST_COOLDOWN_MS = 30 * 60 * 1000;
export const PODCAST_DAILY_CAP = 2;
export const PODCAST_POLICY: LimitPolicy = {
  cooldownMs: PODCAST_COOLDOWN_MS,
  dailyCap: PODCAST_DAILY_CAP,
};

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "daily_cap"; retryAfterSeconds: number };

/**
 * `startedAt` is each run's start time in epoch milliseconds. When both limits apply the answer names
 * the one that lasts longer, because that is how long the person actually has to wait.
 */
export function evaluateLimits(
  startedAt: readonly number[],
  now: number,
  policy: LimitPolicy = BRIEFING_POLICY,
): LimitDecision {
  const recent = startedAt.filter((time) => now - time < DAY_MS).sort((a, b) => a - b);
  const newest = recent.at(-1);

  const cooldownEnds =
    newest !== undefined && now - newest < policy.cooldownMs ? newest + policy.cooldownMs : 0;

  // Over the cap means enough of the oldest runs must age out to leave room for one more.
  const excess = recent.length - (policy.dailyCap - 1);
  const capEnds = excess > 0 ? (recent[excess - 1] ?? 0) + DAY_MS : 0;

  const releasedAt = Math.max(cooldownEnds, capEnds);
  if (releasedAt === 0) return { allowed: true };
  return {
    allowed: false,
    reason: capEnds > cooldownEnds ? "daily_cap" : "cooldown",
    retryAfterSeconds: Math.max(1, Math.ceil((releasedAt - now) / 1000)),
  };
}

/**
 * Digests the Play button may start narrating in one Stockholm day. It counts digests, not requests:
 * every segment of a digest that already has its place passes. The count is read from the month's
 * usage document (narrationState.ts), so this too keeps no store of its own. There is no cooldown:
 * catching up on a few digests in one sitting is ordinary use.
 */
export const NARRATE_DAILY_CAP = 3;
