import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * The ingest layer's tables in Neon (D233): one row per story the engine has read in full
 * (`ingest_items`, keyed by the item id, which is the first 12 hex characters of sha1 of its
 * canonical URL) and one row per ingest run (`ingest_runs`). The text itself is in Blob, under a
 * random key kept here, because a public Blob URL must not be derivable from the story's address.
 * Writes are idempotent, and the first write creates the tables. No driver here: see neon.ts.
 */

export const INGEST_SCHEMA_SQL = [
  `create table if not exists ingest_items (
  item_id text primary key,
  canonical_url text not null,
  source_id text not null,
  title text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  status text not null,
  method text,
  chars integer not null,
  truncated boolean not null,
  archive_key text,
  attempts integer not null
)`,
  "create index if not exists ingest_items_first_seen on ingest_items (first_seen_at)",
  `create table if not exists ingest_runs (
  run_id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  window_from timestamptz not null,
  window_to timestamptz not null,
  sources_ok integer not null,
  sources_failed integer not null,
  fetched integer not null,
  known integer not null,
  archived integer not null,
  unreadable integer not null,
  errors integer not null,
  deferred integer not null,
  chars integer not null,
  ms integer not null,
  github_run_id text
)`,
] as const;

/** `archived` has its text in Blob; `unreadable` is a page no free route could read. */
export type IngestStatus = "archived" | "unreadable";

/** A story, as extracted this run. `first_seen_at` is kept from the first run that read it. */
export interface IngestItemRow {
  item_id: string;
  canonical_url: string;
  source_id: string;
  title: string;
  published_at: string | null;
  seen_at: string;
  status: IngestStatus;
  method: string | null;
  chars: number;
  truncated: boolean;
  archive_key: string | null;
}

export interface IngestRunRecord {
  run_id: string;
  started_at: string;
  finished_at: string;
  window_from: string;
  window_to: string;
  sources_ok: number;
  sources_failed: number;
  fetched: number;
  /** Stories already in the store, left alone. */
  known: number;
  archived: number;
  unreadable: number;
  /** Stories whose text could not be stored this run (Blob refused it); the next run tries again. */
  errors: number;
  /** Stories left for the next run because this one hit its cap. */
  deferred: number;
  /** Characters of text archived. */
  chars: number;
  ms: number;
  github_run_id: string | null;
}

/** A page that stays unreadable this many runs is left alone: a paywall does not open on the fourth try. */
export const MAX_ATTEMPTS = 3;

const ITEMS_SQL = `insert into ingest_items (item_id, canonical_url, source_id, title, published_at,
  first_seen_at, last_seen_at, status, method, chars, truncated, archive_key, attempts)
select n.id, n.url, n.source, n.title, n.published, n.seen, n.seen, n.status,
  n.method, n.chars, n.truncated, n.key, 1
from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[],
  $7::text[], $8::text[], $9::int[], $10::boolean[], $11::text[])
  as n(id, url, source, title, published, seen, status, method, chars, truncated, key)
on conflict (item_id) do update set
  last_seen_at = excluded.last_seen_at, status = excluded.status, method = excluded.method,
  chars = excluded.chars, truncated = excluded.truncated, archive_key = excluded.archive_key,
  attempts = ingest_items.attempts + 1
where ingest_items.status <> 'archived'`;

const TOUCH_SQL = `update ingest_items set last_seen_at = $2::timestamptz
where item_id = any($1::text[]) and last_seen_at < $2::timestamptz`;

/** Stores the stories extracted this run. A story already archived is never replaced. */
export async function recordIngestItems(
  sql: SqlClient,
  rows: readonly IngestItemRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await withTable(sql, INGEST_SCHEMA_SQL, () =>
    sql.query(ITEMS_SQL, [
      rows.map((row) => row.item_id),
      rows.map((row) => row.canonical_url),
      rows.map((row) => row.source_id),
      rows.map((row) => row.title),
      rows.map((row) => row.published_at),
      rows.map((row) => row.seen_at),
      rows.map((row) => row.status),
      rows.map((row) => row.method),
      rows.map((row) => Math.max(0, Math.round(row.chars))),
      rows.map((row) => row.truncated),
      rows.map((row) => row.archive_key),
    ]),
  );
}

/** Marks stories the run met again as seen now. */
export async function touchIngestItems(
  sql: SqlClient,
  ids: readonly string[],
  seenAt: string,
): Promise<void> {
  if (ids.length === 0) return;
  await withTable(sql, INGEST_SCHEMA_SQL, () => sql.query(TOUCH_SQL, [[...ids], seenAt]));
}

/** What the store holds of some stories: the status and how many reads were tried. */
export type KnownItems = ReadonlyMap<string, { status: string; attempts: number }>;

/** The stories among `ids` already in the store. No table yet reads as none. Throws when the database does. */
export async function readKnownItems(sql: SqlClient, ids: readonly string[]): Promise<KnownItems> {
  const known = new Map<string, { status: string; attempts: number }>();
  if (ids.length === 0) return known;
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(
      "select item_id, status, attempts from ingest_items where item_id = any($1::text[])",
      [[...ids]],
    );
  } catch (error) {
    if (missingTable(error)) return known;
    throw error;
  }
  for (const row of rows) {
    known.set(String(row.item_id), {
      status: String(row.status),
      attempts: Number(row.attempts),
    });
  }
  return known;
}

const RUN_SQL = `insert into ingest_runs (run_id, started_at, finished_at, window_from, window_to,
  sources_ok, sources_failed, fetched, known, archived, unreadable, errors, deferred, chars, ms,
  github_run_id)
values ($1, $2::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16)
on conflict (run_id) do nothing`;

/** Stores a finished ingest run. Writing the same run again changes nothing. */
export async function recordIngestRun(sql: SqlClient, run: IngestRunRecord): Promise<void> {
  await withTable(sql, INGEST_SCHEMA_SQL, () =>
    sql.query(RUN_SQL, [
      run.run_id,
      run.started_at,
      run.finished_at,
      run.window_from,
      run.window_to,
      run.sources_ok,
      run.sources_failed,
      run.fetched,
      run.known,
      run.archived,
      run.unreadable,
      run.errors,
      run.deferred,
      run.chars,
      Math.min(2_147_483_647, Math.max(0, Math.round(run.ms))),
      run.github_run_id,
    ]),
  );
}
