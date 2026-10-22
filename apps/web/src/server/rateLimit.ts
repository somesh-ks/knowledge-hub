import { connectConfigStore, type SqlClient } from "@dispatch/engine/config-paths";
import { takeSharedSlot, windowOf } from "@dispatch/engine/rate-counter";
import { describeError } from "./redact";

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

/** How long the counter may take (Neon waking from idle included) before the instance's count stands. */
export const SHARED_TIMEOUT_MS = 1_000;
/** After an error, the instance counts alone this long before it asks again. */
export const SHARED_BACKOFF_MS = 30_000;
/** After a timeout, a shorter wait: the database is likely waking, and its upsert still counts. */
export const SHARED_SLOW_BACKOFF_MS = 5_000;

export interface SharedLimiterDeps {
  /** DATABASE_URL; unset or empty means the instance counts alone. */
  databaseUrl: string | undefined;
  /** Opens the database; Neon's HTTP driver by default (D149's loader), only when a URL is set. */
  connect?: (url: string) => Promise<SqlClient>;
  now?: () => number;
  log?: (message: string) => void;
}

/** Takes one slot of `bucket`'s minute; false when the cap is reached. Never throws. */
export type SharedLimiter = (bucket: string, perMinute: number) => Promise<boolean>;

/**
 * A per-minute limit counted across every instance, in Neon (`rate_limit_counters`, created by
 * `dispatch config seed`). Each request first takes a slot of this instance's own window, so the
 * shared count can only tighten the limit, never loosen it; then one upsert counts it across
 * instances. With no DATABASE_URL, a database error, or no answer within SHARED_TIMEOUT_MS, the
 * instance's slot stands alone: a counter that is down never fails a request, and the instance
 * stops asking it for a while (SHARED_BACKOFF_MS after an error, SHARED_SLOW_BACKOFF_MS after a
 * timeout) so a missing table or a sleeping database costs one wait, not one per request.
 */
export function createSharedLimiter(deps: SharedLimiterDeps): SharedLimiter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(`[rate-limit] ${message}`));
  // The instance's own count uses the counter's clock-aligned minutes, so a refusal's wait (to the
  // end of the minute) is right whichever count refused.
  const local = new Map<string, { window: number; count: number }>();
  let client: Promise<SqlClient> | null = null;
  let quietUntil = 0;

  async function sharedSlot(url: string, bucket: string, perMinute: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = Symbol("slow");
    const timeout = new Promise<typeof slow>((done) => {
      timer = setTimeout(() => done(slow), SHARED_TIMEOUT_MS);
    });
    try {
      const take = async () => {
        client ??= (deps.connect ?? connectConfigStore)(url);
        return takeSharedSlot(await client, bucket, perMinute, now());
      };
      const answer = await Promise.race([take(), timeout]);
      if (answer !== slow) return answer;
      // A connect that hangs must not be awaited by every later request: open a fresh one.
      client = null;
      quietUntil = now() + SHARED_SLOW_BACKOFF_MS;
      log(`shared counter slow (over ${SHARED_TIMEOUT_MS} ms), counting per instance`);
      return true;
    } catch (error) {
      client = null;
      quietUntil = now() + SHARED_BACKOFF_MS;
      log(`shared counter unavailable, counting per instance: ${describeError(error, [url])}`);
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  return async (bucket, perMinute) => {
    const window = windowOf(now(), 60_000);
    const mine = local.get(bucket);
    const count = mine?.window === window ? mine.count : 0;
    if (count >= perMinute) return false;
    local.set(bucket, { window, count: count + 1 });
    const url = deps.databaseUrl;
    if (url === undefined || url === "" || now() < quietUntil) return true;
    return sharedSlot(url, bucket, perMinute);
  };
}

/** The site's shared limiter, one per instance. */
export const sharedLimit: SharedLimiter = createSharedLimiter({
  databaseUrl: process.env.DATABASE_URL,
});

/**
 * A burst cap for a route that starts a workflow: 0 to go ahead, or the seconds to the end of the
 * counter's minute. The handlers take it only after the origin, the body and the passphrase have
 * passed, so a request from another site cannot use up the owner's minute.
 */
export function burstCap(
  bucket: string,
  perMinute: number,
  limit: SharedLimiter = sharedLimit,
  now: () => number = Date.now,
): () => Promise<number> {
  return async () =>
    (await limit(bucket, perMinute))
      ? 0
      : Math.max(1, Math.ceil((60_000 - (now() % 60_000)) / 1000));
}
