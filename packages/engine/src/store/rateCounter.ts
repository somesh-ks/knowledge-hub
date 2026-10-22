import type { SqlClient } from "./configPaths.js";

/**
 * A rate-limit counter every serverless instance shares, in the same Neon database as the config
 * store (D149). The site is open (D41), so the caps on its paid routes must hold across instances: a
 * cold start must not hand out a fresh minute. One row per bucket holds the current window's number
 * and count, so the table never grows past the number of buckets. No driver here: see neon.ts.
 */
export const RATE_LIMIT_SCHEMA_SQL = `create table if not exists rate_limit_counters (
  bucket text primary key,
  window_id bigint not null,
  count integer not null
)`;

/**
 * One atomic upsert. A newer window restarts the count at 1; the same window adds 1; an older one
 * (an instance whose clock runs behind at a boundary) counts into the stored window, so a late
 * clock can never reset a full window.
 */
const TAKE_SQL = `insert into rate_limit_counters (bucket, window_id, count) values ($1, $2, 1)
on conflict (bucket) do update set
  count = case when excluded.window_id > rate_limit_counters.window_id then 1
               else rate_limit_counters.count + 1 end,
  window_id = greatest(rate_limit_counters.window_id, excluded.window_id)
returning count`;

/** The fixed window `now` falls in, numbered from the epoch. */
export const windowOf = (now: number, windowMs: number): number => Math.floor(now / windowMs);

/**
 * Takes one slot of `bucket`'s window: true while the window has held at most `perWindow` requests,
 * this one included. A refused request still counts, so a flood stays refused for the whole window.
 * Throws when the database does; the caller decides what a failure means.
 */
export async function takeSharedSlot(
  sql: SqlClient,
  bucket: string,
  perWindow: number,
  now: number,
  windowMs = 60_000,
): Promise<boolean> {
  const rows = await sql.query(TAKE_SQL, [bucket, windowOf(now, windowMs)]);
  const count = Number(rows[0]?.count);
  if (!Number.isFinite(count)) throw new Error("rate counter: the upsert returned no count");
  return count <= perWindow;
}
