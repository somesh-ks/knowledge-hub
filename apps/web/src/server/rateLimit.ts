import type { SqlClient } from "@dispatch/engine/config-paths";
import { describeError } from "./redact";

/**
 * A fixed-window rate limit for the open routes (D41: no passphrase), one per function instance: a
 * cold start resets it. It is the floor under the shared limit below, and the whole limit when the
 * shared counter is off or down.
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

/** How long the counter may take before a request goes ahead on the instance's own count. */
export const SHARED_TIMEOUT_MS = 400;
/** After a failure or a timeout, the instance counts alone this long before it asks again. */
export const SHARED_BACKOFF_MS = 30_000;

export interface SharedLimiterDeps {
  /** DATABASE_URL; unset or empty means the instance counts alone. */
  databaseUrl: string | undefined;
  /** Opens the database; Neon's HTTP driver by default, loaded only when a URL is set. */
  connect?: (url: string) => Promise<SqlClient>;
  now?: () => number;
  log?: (message: string) => void;
}

/** Takes one slot of `bucket`'s minute; false when the cap is reached. Never throws. */
export type SharedLimiter = (bucket: string, perMinute: number) => Promise<boolean>;

const defaultConnect = async (url: string): Promise<SqlClient> => {
  const { connectNeon } = await import("@dispatch/engine/neon");
  return connectNeon(url);
};

/**
 * A per-minute limit counted across every instance, in Neon (`rate_limit_counters`, created by
 * `dispatch config seed`). Each request first takes a slot of this instance's own window, so the
 * shared count can only tighten the limit, never loosen it; then one upsert counts it across
 * instances. With no DATABASE_URL, a database error, or no answer within SHARED_TIMEOUT_MS, the
 * instance's slot stands alone: a counter that is down never fails a request, and the instance
 * stops asking it for SHARED_BACKOFF_MS so a missing table or a sleeping database costs one wait.
 */
export function createSharedLimiter(deps: SharedLimiterDeps): SharedLimiter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(`[rate-limit] ${message}`));
  const local = new Map<string, WindowLimiter>();
  let client: Promise<SqlClient> | null = null;
  let quietUntil = 0;

  async function sharedSlot(url: string, bucket: string, perMinute: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer in ${SHARED_TIMEOUT_MS} ms`)),
        SHARED_TIMEOUT_MS,
      );
    });
    try {
      const take = async () => {
        client ??= (deps.connect ?? defaultConnect)(url);
        const { takeSharedSlot } = await import("@dispatch/engine/rate-counter");
        return takeSharedSlot(await client, bucket, perMinute, now());
      };
      return await Promise.race([take(), timeout]);
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
    let limiter = local.get(bucket);
    if (limiter === undefined) {
      limiter = newLimiter();
      local.set(bucket, limiter);
    }
    if (!takeSlot(limiter, perMinute, now())) return false;
    const url = deps.databaseUrl;
    if (url === undefined || url === "" || now() < quietUntil) return true;
    return sharedSlot(url, bucket, perMinute);
  };
}

/** The site's shared limiter, one per instance. */
export const sharedLimit: SharedLimiter = createSharedLimiter({
  databaseUrl: process.env.DATABASE_URL,
});

/** What a workflow route answers when its shared per-minute cap is full: the cooldown its page knows. */
export const floodRefusal = {
  status: 429,
  headers: { "Retry-After": "60" },
  body: { status: 429, error: "cooldown", retry_after_s: 60 },
};
