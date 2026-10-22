import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * Client faults in Neon (D158), beside the field vitals (vitalsStore.ts): `/api/report` adds a page's
 * uncaught error, unhandled rejection or CSP violation, `dispatch health` reads the week. Vercel
 * Hobby keeps function logs for an hour, so a log line alone was never seen. A row holds only the
 * kind, the route template, the start of the message (cut before anything a reader typed could
 * be), for CSP the directive and the blocked origin, the origin or scheme of the script that
 * raised it, and the build: no address, no identifier, no user agent. Bounded like the vitals:
 * every insert deletes what fell out of the window, as does health each day, and an hour takes at
 * most FAULT_ROWS_PER_HOUR rows, so only a flood is cut. No driver here: see neon.ts.
 */

export const FAULTS_WINDOW_DAYS = 7;
/** Far above an ordinary hour (a page sends at most five); it only stops a flood or a loop. */
export const FAULT_ROWS_PER_HOUR = 120;
/**
 * What a cross-origin script's error reads as: the browser hides its message ("Script error.").
 * It says nothing to act on, so health does not count it.
 */
export const OPAQUE_SCRIPT_ERROR = "cross-origin script error";

export const FAULTS_SCHEMA_SQL = [
  `create table if not exists client_faults (
  at timestamptz not null,
  kind text not null,
  page text not null,
  message text not null default '',
  directive text not null default '',
  blocked text not null default '',
  source text not null default '',
  build text not null default ''
)`,
  "create index if not exists client_faults_at on client_faults (at)",
] as const;

/** `server`: a 5xx a site function answered (http.ts answerWithRef), its page the route label. */
export type ClientFaultKind = "error" | "rejection" | "csp" | "server";

/** One fault as the server checked it (apps/web/src/server/faults.ts). */
export interface ClientFault {
  kind: ClientFaultKind;
  page: string;
  message: string;
  directive: string;
  blocked: string;
  /** The origin (or scheme) of the script that raised it; never a path. */
  source: string;
  build: string;
}

const RECORD_SQL = `with gone as (
  delete from client_faults where at <= to_timestamp($1::float8 / 1000) - $10::int * interval '1 day'
), recent as (
  select count(*) as n from client_faults where at > to_timestamp($1::float8 / 1000) - interval '1 hour'
)
insert into client_faults (at, kind, page, message, directive, blocked, source, build)
select to_timestamp($1::float8 / 1000), $2, $3, $4, $5, $6, $7, $8 from recent
where recent.n < $9::int
returning 1`;

const PRUNE_SQL = `delete from client_faults
where at <= to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'`;

const READ_SQL = `select kind, page, message, directive, blocked, source, build, count(*)::int as total,
  (count(*) filter (where at > to_timestamp($1::float8 / 1000) - interval '1 day'))::int as day
from client_faults
where at > to_timestamp($1::float8 / 1000) - $2::int * interval '1 day'
group by kind, page, message, directive, blocked, source, build`;

/**
 * Stores one fault at `now` (epoch ms): 1 when kept, 0 when the hour is full. The first report
 * creates the table. Throws when the database does; the caller decides what a failure means.
 */
export async function recordClientFault(
  sql: SqlClient,
  fault: ClientFault,
  now: number,
  perHour = FAULT_ROWS_PER_HOUR,
): Promise<number> {
  const params = [
    now,
    fault.kind,
    fault.page,
    fault.message,
    fault.directive,
    fault.blocked,
    fault.source,
    fault.build,
    perHour,
    FAULTS_WINDOW_DAYS,
  ];
  return withTable(
    sql,
    FAULTS_SCHEMA_SQL,
    async () => (await sql.query(RECORD_SQL, params)).length,
  );
}

/** Deletes what is older than the window (health's daily read calls it). Throws when the database does. */
export async function pruneClientFaults(sql: SqlClient, now: number): Promise<void> {
  try {
    await sql.query(PRUNE_SQL, [now, FAULTS_WINDOW_DAYS]);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

/** One group of alike faults over the window: how many, and how many in the last 24 hours. */
export interface ClientFaultGroup extends ClientFault {
  total: number;
  day: number;
}

/**
 * The window's faults, grouped; null when no report has created the table yet (nothing was
 * measured, which is not "clean"). Throws when the database does.
 */
export async function readClientFaults(
  sql: SqlClient,
  now: number,
): Promise<ClientFaultGroup[] | null> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(READ_SQL, [now, FAULTS_WINDOW_DAYS]);
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  return rows.map((row) => ({
    kind: String(row.kind) as ClientFaultKind,
    page: String(row.page),
    message: String(row.message),
    directive: String(row.directive),
    blocked: String(row.blocked),
    source: String(row.source),
    build: String(row.build),
    total: Number(row.total),
    day: Number(row.day),
  }));
}
