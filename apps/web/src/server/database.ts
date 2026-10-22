import { connectConfigStore, type SqlClient } from "@dispatch/engine/config-paths";
import { describeError } from "./redact";

/** How long a query may take (Neon waking from idle included) before the caller's fallback stands. */
export const DATABASE_TIMEOUT_MS = 1_000;
/** After an error, the database is left alone this long. */
export const DATABASE_BACKOFF_MS = 30_000;
/** After a timeout, a shorter wait: the database is likely waking, and the query may still land. */
export const DATABASE_SLOW_BACKOFF_MS = 5_000;

export interface DatabaseDeps {
  /** DATABASE_URL; unset or empty means there is no database and every call answers its fallback. */
  databaseUrl: string | undefined;
  /** Opens the database; Neon's HTTP driver by default (D149's loader), only when a URL is set. */
  connect?: (url: string) => Promise<SqlClient>;
  now?: () => number;
  log?: (message: string) => void;
  /** How long to wait before the fallback stands; DATABASE_TIMEOUT_MS unless the caller has longer. */
  timeoutMs?: number;
}

/** Runs `work` on the database, or answers `fallback` without it. Never throws. */
export type DatabaseCall = <T>(work: (sql: SqlClient) => Promise<T>, fallback: T) => Promise<T>;

/**
 * The site's way to Neon for work a request must never wait on or fail for: the shared rate-limit
 * counter (D150) and field Web Vitals (D156). With no URL, a database error, or no answer in time
 * (DATABASE_TIMEOUT_MS by default), the call answers its fallback, and the instance stops asking for a while
 * (DATABASE_BACKOFF_MS after an error, DATABASE_SLOW_BACKOFF_MS after a timeout), so a missing table
 * or a sleeping database costs one wait, not one per request. One per use, so each backs off alone.
 */
export function guardedDatabase(deps: DatabaseDeps): DatabaseCall {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(message));
  const timeoutMs = deps.timeoutMs ?? DATABASE_TIMEOUT_MS;
  let client: Promise<SqlClient> | null = null;
  let quietUntil = 0;

  return async <T>(work: (sql: SqlClient) => Promise<T>, fallback: T): Promise<T> => {
    const url = deps.databaseUrl;
    if (url === undefined || url === "" || now() < quietUntil) return fallback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = Symbol("slow");
    const timeout = new Promise<typeof slow>((done) => {
      timer = setTimeout(() => done(slow), timeoutMs);
    });
    try {
      const run = async () => {
        client ??= (deps.connect ?? connectConfigStore)(url);
        return work(await client);
      };
      const answer = await Promise.race([run(), timeout]);
      if (answer !== slow) return answer;
      // A connect that hangs must not be awaited by every later request: open a fresh one.
      client = null;
      quietUntil = now() + DATABASE_SLOW_BACKOFF_MS;
      log(`slow (over ${timeoutMs} ms)`);
      return fallback;
    } catch (error) {
      client = null;
      quietUntil = now() + DATABASE_BACKOFF_MS;
      log(`unavailable: ${describeError(error, [url])}`);
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
}
