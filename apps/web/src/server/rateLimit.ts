/**
 * A fixed-window rate limit for the open routes (D41: no passphrase), one per function instance: a
 * cold start resets it, which is fine for a guard against floods and runaway bills.
 */
export interface WindowLimiter {
  windowStart: number;
  count: number;
}

export const newLimiter = (): WindowLimiter => ({ windowStart: 0, count: 0 });

/** Takes one slot of this minute's `perMinute`; false when the window is full. */
export function takeSlot(limiter: WindowLimiter, perMinute: number, now: number): boolean {
  if (now - limiter.windowStart >= 60_000) {
    limiter.windowStart = now;
    limiter.count = 0;
  }
  if (limiter.count >= perMinute) return false;
  limiter.count += 1;
  return true;
}
