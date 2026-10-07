/**
 * Rate limits for the Generate button, computed from the workflow runs GitHub already lists, so the
 * function keeps no state of its own. One on-demand run per 6 hours and three per 24 hours. The count
 * includes every workflow_dispatch run of run.yml, whoever started it (build plan 8.9).
 */
export const COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_CAP = 3;

export type LimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "cooldown" | "daily_cap"; retryAfterSeconds: number };

/**
 * `startedAt` is each run's start time in epoch milliseconds. When both limits apply the answer names
 * the one that lasts longer, because that is how long the person actually has to wait.
 */
export function evaluateLimits(startedAt: readonly number[], now: number): LimitDecision {
  const recent = startedAt.filter((time) => now - time < DAY_MS).sort((a, b) => a - b);
  const newest = recent.at(-1);

  const cooldownEnds =
    newest !== undefined && now - newest < COOLDOWN_MS ? newest + COOLDOWN_MS : 0;

  // Over the cap means enough of the oldest runs must age out to leave room for one more.
  const excess = recent.length - (DAILY_CAP - 1);
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
 * Narrations per 24 hours for the Play button, counted from the MP3 uploads the Blob store already
 * lists, so this too keeps no state of its own. Every upload counts, whoever made it. There is no
 * cooldown: catching up on a few digests in one sitting is ordinary use.
 */
export const NARRATE_DAILY_CAP = 3;

export type DailyCapDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** `uploadedAt` is each narration's upload time in epoch milliseconds. */
export function evaluateDailyCap(
  uploadedAt: readonly number[],
  now: number,
  cap: number = NARRATE_DAILY_CAP,
): DailyCapDecision {
  const recent = uploadedAt.filter((time) => now - time < DAY_MS).sort((a, b) => a - b);
  // At the cap, the oldest of the recent uploads has to age out before one more fits.
  const excess = recent.length - (cap - 1);
  if (excess <= 0) return { allowed: true };
  const releasedAt = (recent[excess - 1] ?? now) + DAY_MS;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((releasedAt - now) / 1000)) };
}
