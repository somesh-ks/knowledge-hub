import type { SqlClient } from "./configPaths.js";
import { withTable } from "./pgErrors.js";

/**
 * Share links in Neon (D153), in the database the config store, the rate counter and the vitals
 * use (D149, D150, D156). A link opens one briefing or episode on the public listen page. Each play
 * there counts against the link's own cap and the month's shared-play byte budget, so strangers can
 * never use up the Blob transfer the owner's own listening needs. Only the links and the counts are
 * kept: nothing about a listener. The tables are created by their first write, as the vitals and
 * the rate counter are. No driver here: see neon.ts.
 */

export const SHARE_SCHEMA_SQL = [
  `create table if not exists share_links (
  id text primary key,
  item_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  plays integer not null default 0,
  bytes bigint not null,
  segments jsonb not null,
  source text not null
)`,
  // One active link per item: a second make races to the same row instead of a second link.
  "create unique index if not exists share_links_active on share_links (item_id) where revoked_at is null",
  `create table if not exists share_budget (
  month text primary key,
  bytes bigint not null
)`,
] as const;

/** One stored audio file of a shared item, in playing order. */
export interface SharedSegment {
  url: string;
  duration_ms: number;
}

export interface ShareLink {
  id: string;
  item_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  plays: number;
  /** The item's audio in bytes: what one play start is charged against the month's budget. */
  bytes: number;
  segments: SharedSegment[];
  /**
   * What the link was made from: a fingerprint of the item's audio files as the narration lookup
   * named them. A Regenerate changes it, and the link then stops rather than play the old audio.
   */
  source: string;
}

/** The caps a play is checked against; the site keeps the values (apps/web/src/lib/share.ts). */
export interface PlayLimits {
  playsPerLink: number;
  monthlyBytes: number;
}

/** What a play start was told: the segments, or why not. */
export type PlayGrant =
  | { granted: true; link: ShareLink }
  | { granted: false; reason: "not_found" | "gone" | "link_limit" | "month_limit" };

/** The month a play is charged to, UTC: "2026-10". */
export const budgetMonth = (now: number): string => new Date(now).toISOString().slice(0, 7);

const columns = (table: string): string => `${table}.id, ${table}.item_id,
  (extract(epoch from ${table}.created_at) * 1000)::float8 as created_at,
  (extract(epoch from ${table}.expires_at) * 1000)::float8 as expires_at,
  (extract(epoch from ${table}.revoked_at) * 1000)::float8 as revoked_at,
  ${table}.plays, ${table}.bytes, ${table}.segments, ${table}.source`;
const COLUMNS = columns("share_links");

function toLink(row: Record<string, unknown>): ShareLink {
  const raw = typeof row.segments === "string" ? JSON.parse(row.segments) : row.segments;
  const segments = Array.isArray(raw)
    ? raw.flatMap((entry) =>
        entry && typeof entry.url === "string" && typeof entry.duration_ms === "number"
          ? [{ url: entry.url, duration_ms: entry.duration_ms }]
          : [],
      )
    : [];
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
    revoked_at:
      row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
    plays: Number(row.plays),
    bytes: Number(row.bytes),
    segments,
    source: String(row.source),
  };
}

const ACTIVE_SQL = `select ${COLUMNS} from share_links
where item_id = $1 and revoked_at is null and expires_at > to_timestamp($2::float8 / 1000)`;

/**
 * The item's link that still works at `now`, or null. Throws when the database does; no table yet
 * reads as no link.
 */
export async function activeShareLink(
  sql: SqlClient,
  itemId: string,
  now: number,
): Promise<ShareLink | null> {
  const rows = await withTable(sql, SHARE_SCHEMA_SQL, () => sql.query(ACTIVE_SQL, [itemId, now]));
  return rows[0] ? toLink(rows[0]) : null;
}

/** An expired link still holds the item's one active slot until it is closed. */
const CLOSE_EXPIRED_SQL = `update share_links set revoked_at = expires_at
where item_id = $1 and revoked_at is null and expires_at <= to_timestamp($2::float8 / 1000)`;

const INSERT_SQL = `insert into share_links
  (id, item_id, created_at, expires_at, plays, bytes, segments, source)
values ($1, $2, to_timestamp($3::float8 / 1000), to_timestamp($4::float8 / 1000), 0, $5, $6::jsonb, $7)
on conflict (item_id) where revoked_at is null do nothing
returning ${COLUMNS}`;

export interface NewShareLink {
  id: string;
  itemId: string;
  now: number;
  expiresAt: number;
  bytes: number;
  segments: SharedSegment[];
  source: string;
}

/**
 * Makes the item's link, or answers the one another request made first (one active link per item).
 * Throws when the database does.
 */
export async function createShareLink(sql: SqlClient, link: NewShareLink): Promise<ShareLink> {
  return withTable(sql, SHARE_SCHEMA_SQL, async () => {
    await sql.query(CLOSE_EXPIRED_SQL, [link.itemId, link.now]);
    const rows = await sql.query(INSERT_SQL, [
      link.id,
      link.itemId,
      link.now,
      link.expiresAt,
      link.bytes,
      JSON.stringify(link.segments),
      link.source,
    ]);
    if (rows[0]) return toLink(rows[0]);
    const winner = await sql.query(ACTIVE_SQL, [link.itemId, link.now]);
    if (!winner[0]) throw new Error("share store: the item's link was neither made nor found");
    return toLink(winner[0]);
  });
}

const REVOKE_SQL = `update share_links set revoked_at = to_timestamp($2::float8 / 1000)
where item_id = $1 and revoked_at is null returning id`;

/** Stops every working link of the item; how many it stopped. Throws when the database does. */
export async function revokeShareLinks(
  sql: SqlClient,
  itemId: string,
  now: number,
): Promise<number> {
  return (await withTable(sql, SHARE_SCHEMA_SQL, () => sql.query(REVOKE_SQL, [itemId, now])))
    .length;
}

/**
 * Hands back a granted play of one link: its count, and its bytes to the month it was charged to.
 * With $4 true it also stops the link, whose item changed or went away since the grant.
 */
const REVOKE_GRANTED_SQL = `with stopped as (
  update share_links
  set revoked_at = case when $4 then to_timestamp($2::float8 / 1000) else revoked_at end,
    plays = greatest(plays - 1, 0)
  where id = $1 and revoked_at is null
  returning bytes
)
update share_budget set bytes = greatest(share_budget.bytes - stopped.bytes, 0)
from stopped where share_budget.month = $3
returning share_budget.month`;

/**
 * Refunds a granted play of link `id`, and stops the link unless `stop` is false (the play failed
 * for a reason of the server's, not the item's). Throws when the database does.
 */
export async function revokeGrantedLink(
  sql: SqlClient,
  id: string,
  now: number,
  stop = true,
): Promise<void> {
  await withTable(sql, SHARE_SCHEMA_SQL, () =>
    sql.query(REVOKE_GRANTED_SQL, [id, now, budgetMonth(now), stop]),
  );
}

const READ_SQL = `select ${COLUMNS} from share_links where id = $1`;

/** A link by its id, whatever its state, or null. Only reads. Throws when the database does. */
export async function readShareLink(sql: SqlClient, id: string): Promise<ShareLink | null> {
  const rows = await withTable(sql, SHARE_SCHEMA_SQL, () => sql.query(READ_SQL, [id]));
  return rows[0] ? toLink(rows[0]) : null;
}

/** Whether a link opens at `now`: not revoked and not past its expiry. */
export const linkWorks = (link: ShareLink, now: number): boolean =>
  link.revoked_at === null && link.expires_at > now;

/**
 * One statement, and one round trip for a granted play. The month's row is charged first, by an
 * UPDATE whose condition reads the row it locks: a play waiting on another re-reads the spend that
 * play left, so concurrent plays can never take the month past its budget. Then the link's count
 * goes up, under the same condition on its own row. A play that loses a race for a link's last play
 * has charged the month for nothing: the budget errs low, never high.
 */
const PLAY_SQL = `with charged as (
  update share_budget set bytes = share_budget.bytes + link.bytes
  from share_links link
  where share_budget.month = $2
    and link.id = $1
    and link.revoked_at is null
    and link.expires_at > to_timestamp($3::float8 / 1000)
    and link.plays < $4::int
    and share_budget.bytes + link.bytes <= $5::bigint
  returning link.id
)
update share_links set plays = plays + 1
where share_links.id = (select id from charged) and share_links.plays < $4::int
returning ${COLUMNS}`;

/** Why a play was not granted, and whether the month has a row yet to be charged. */
const EXPLAIN_SQL = `select ${COLUMNS},
  (select bytes from share_budget where month = $2) as month_bytes
from share_links where id = $1`;

/** The month's row, so the play's UPDATE has one to lock; the first play of a month makes it. */
const OPEN_MONTH_SQL = `insert into share_budget (month, bytes) values ($1, 0)
on conflict (month) do nothing`;

/**
 * Counts one play start of link `id` at `now` against its cap and the month's budget, or says why
 * it may not start. Throws when the database does.
 */
export async function startSharedPlay(
  sql: SqlClient,
  id: string,
  now: number,
  limits: PlayLimits,
): Promise<PlayGrant> {
  const month = budgetMonth(now);
  return withTable(sql, SHARE_SCHEMA_SQL, async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const granted = await sql.query(PLAY_SQL, [
        id,
        month,
        now,
        limits.playsPerLink,
        limits.monthlyBytes,
      ]);
      if (granted[0]) return { granted: true, link: toLink(granted[0]) };
      const rows = await sql.query(EXPLAIN_SQL, [id, month]);
      const row = rows[0];
      if (!row) return { granted: false, reason: "not_found" };
      const link = toLink(row);
      if (!linkWorks(link, now)) return { granted: false, reason: "gone" };
      if (link.plays >= limits.playsPerLink) return { granted: false, reason: "link_limit" };
      if (row.month_bytes === null || row.month_bytes === undefined) {
        await sql.query(OPEN_MONTH_SQL, [month]);
        continue;
      }
      if (Number(row.month_bytes) + link.bytes > limits.monthlyBytes) break;
    }
    return { granted: false, reason: "month_limit" };
  });
}
