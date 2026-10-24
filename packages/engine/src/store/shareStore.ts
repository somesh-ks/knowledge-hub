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
  segments jsonb not null
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

const COLUMNS = `id, item_id,
  (extract(epoch from created_at) * 1000)::float8 as created_at,
  (extract(epoch from expires_at) * 1000)::float8 as expires_at,
  (extract(epoch from revoked_at) * 1000)::float8 as revoked_at,
  plays, bytes, segments`;

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

const INSERT_SQL = `insert into share_links (id, item_id, created_at, expires_at, plays, bytes, segments)
values ($1, $2, to_timestamp($3::float8 / 1000), to_timestamp($4::float8 / 1000), 0, $5, $6::jsonb)
on conflict (item_id) where revoked_at is null do nothing
returning ${COLUMNS}`;

export interface NewShareLink {
  id: string;
  itemId: string;
  now: number;
  expiresAt: number;
  bytes: number;
  segments: SharedSegment[];
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
 * One statement: the play is granted only while the link works, is under its cap and the month has
 * room for the item's bytes; then the link's plays and the month's bytes go up together. The row
 * lock on the link serialises its own plays; two plays of different links at the very edge of the
 * month can pass it together, by one item's bytes at most.
 */
const PLAY_SQL = `with used as (
  select coalesce((select bytes from share_budget where month = $2), 0)::bigint as bytes
), bumped as (
  update share_links set plays = plays + 1
  from used
  where share_links.id = $1
    and share_links.revoked_at is null
    and share_links.expires_at > to_timestamp($3::float8 / 1000)
    and share_links.plays < $4::int
    and used.bytes + share_links.bytes <= $5::bigint
  returning share_links.bytes
), spent as (
  insert into share_budget (month, bytes) select $2, bytes from bumped
  on conflict (month) do update set bytes = share_budget.bytes + excluded.bytes
  returning bytes
)
select (select count(*) from bumped)::int as granted, (select bytes from used) as used`;

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
  return withTable(sql, SHARE_SCHEMA_SQL, async () => {
    const rows = await sql.query(PLAY_SQL, [
      id,
      budgetMonth(now),
      now,
      limits.playsPerLink,
      limits.monthlyBytes,
    ]);
    const before = await sql.query(READ_SQL, [id]);
    if (!before[0]) return { granted: false, reason: "not_found" };
    const link = toLink(before[0]);
    if (Number(rows[0]?.granted) > 0) return { granted: true, link };
    if (!linkWorks(link, now)) return { granted: false, reason: "gone" };
    if (link.plays >= limits.playsPerLink) return { granted: false, reason: "link_limit" };
    return { granted: false, reason: "month_limit" };
  });
}
