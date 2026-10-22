import { takeSharedSlot, windowOf } from "@dispatch/engine/rate-counter";
import { type DatabaseDeps, guardedDatabase } from "./database";

/**
 * A fixed-window rate limit, one per function instance: a cold start resets it. For a route that
 * spends nothing (`/api/report`); the paid routes use the shared limit below.
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

export type SharedLimiterDeps = DatabaseDeps;

/** Takes one slot of `bucket`'s minute; false when the cap is reached. Never throws. */
export type SharedLimiter = (bucket: string, perMinute: number) => Promise<boolean>;

/**
 * A per-minute limit counted across every instance, in Neon (`rate_limit_counters`, created by
 * `dispatch config seed`). Each request first takes a slot of this instance's own window, so the
 * shared count can only tighten the limit, never loosen it; then one upsert counts it across
 * instances. With no DATABASE_URL, a database error, or no answer in time, the instance's slot stands
 * alone: a counter that is down never fails a request, and the instance stops asking it for a while
 * (`guardedDatabase`).
 */
export function createSharedLimiter(deps: SharedLimiterDeps): SharedLimiter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(`[rate-limit] ${message}`));
  const database = guardedDatabase({
    ...deps,
    log: (message) => log(`shared counter ${message}, counting per instance`),
  });
  // The instance's own count uses the counter's clock-aligned minutes, so a refusal's wait (to the
  // end of the minute) is right whichever count refused.
  const local = new Map<string, { window: number; count: number }>();

  return async (bucket, perMinute) => {
    const window = windowOf(now(), 60_000);
    const mine = local.get(bucket);
    const count = mine?.window === window ? mine.count : 0;
    if (count >= perMinute) return false;
    local.set(bucket, { window, count: count + 1 });
    return database((sql) => takeSharedSlot(sql, bucket, perMinute, now()), true);
  };
}

/** The site's shared limiter, one per instance. */
export const sharedLimit: SharedLimiter = createSharedLimiter({
  databaseUrl: process.env.DATABASE_URL,
});

/** The 429 a route answers while its burst cap is full. */
export const cooldownRefusal = (wait: number) => ({
  status: 429 as const,
  headers: { "Retry-After": String(wait) },
  body: { status: 429 as const, error: "cooldown" as const, retry_after_s: wait },
});

/**
 * A burst cap for a paid route (the ones that start a workflow, and narration): 0 to go ahead, or
 * the seconds to the end of the counter's minute. The handlers take it only after the origin, the
 * body and the passphrase have passed, so a request from another site cannot use up the owner's
 * minute.
 */
export function burstCap(
  bucket: string,
  perMinute: number,
  limit: SharedLimiter = sharedLimit,
  now: () => number = Date.now,
): () => Promise<number> {
  return async () => {
    const at = now();
    return (await limit(bucket, perMinute))
      ? 0
      : Math.max(1, Math.ceil((60_000 - (at % 60_000)) / 1000));
  };
}
