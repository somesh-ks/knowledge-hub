import { createECDH } from "node:crypto";
import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * Who is waiting for a run to end (D284), in the Neon database the config store, the rate counter
 * and the run log use. A `push_watches` row says that the browser behind `endpoint` started the run
 * `run_id` (the GitHub run id, the one the site's cancel token is made from) and asked to be told
 * when it ends. The site writes a row when a Catch up or a Regenerate starts on a device that
 * switched notifications on; the content workflow reads the open ones after each sync, sends one
 * message to each whose run has ended (`pipeline_runs`, D221) and deletes the row. Nothing about the
 * reader is kept but the address their browser gave and its two keys, for a few hours at most. The
 * table is created by its first write. No driver here: see neon.ts.
 */

export const PUSH_SCHEMA_SQL = [
  `create table if not exists push_watches (
  run_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  kind text not null,
  created_at timestamptz not null,
  primary key (run_id, endpoint)
)`,
  "create index if not exists push_watches_created on push_watches (created_at)",
  `create table if not exists push_devices (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  daily boolean not null,
  weekly boolean not null,
  updated_at timestamptz not null
)`,
  `create table if not exists push_announced (
  run_id text primary key,
  announced_at timestamptz not null
)`,
  `create table if not exists push_keys (
  id integer primary key,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null
)`,
] as const;

/** The key pair that signs every message (VAPID). Made by the site on first use and kept in Neon. */
export interface PushKeys {
  publicKey: string;
  privateKey: string;
}

/** A P-256 pair in the URL-safe base64 form Web Push uses: 65 bytes public, 32 bytes private. */
export function generateVapidKeys(): PushKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

/**
 * The key pair, made and stored on the first call. Two first calls at once both try to insert and
 * the row that lands wins: both read it back, so the browser and the workflow never disagree.
 */
export async function ensurePushKeys(sql: SqlClient, now: number): Promise<PushKeys> {
  const read = async (): Promise<PushKeys | null> => {
    const rows = await sql.query("select public_key, private_key from push_keys where id = 1");
    const row = rows[0];
    return row ? { publicKey: String(row.public_key), privateKey: String(row.private_key) } : null;
  };
  const existing = await withTable(sql, PUSH_SCHEMA_SQL, read);
  if (existing) return existing;
  const made = generateVapidKeys();
  await sql.query(
    `insert into push_keys (id, public_key, private_key, created_at) values (1, $1, $2, $3::timestamptz)
on conflict (id) do nothing`,
    [made.publicKey, made.privateKey, new Date(now).toISOString()],
  );
  return (await read()) ?? made;
}

/** The stored pair, or null before any browser has asked for the public key. Never creates one. */
export async function readPushKeys(sql: SqlClient): Promise<PushKeys | null> {
  try {
    const rows = await sql.query("select public_key, private_key from push_keys where id = 1");
    const row = rows[0];
    return row ? { publicKey: String(row.public_key), privateKey: String(row.private_key) } : null;
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

/** Most browsers that may wait for one run: a person has a phone and a laptop, not a crowd. */
export const MAX_WATCHES_PER_RUN = 2;
/** A watch older than this is dropped unsent: a run that long is not the two-minute wait it was for. */
export const WATCH_LIFETIME_MS = 6 * 3_600_000;

/**
 * The push services the browsers use. The address a browser hands over is a URL this project's
 * workflow will post to, so only these hosts are taken: a made-up one could aim the workflow at an
 * internal address.
 */
const PUSH_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[\w-]+\.push\.services\.mozilla\.com$/,
  /^([\w-]+\.)?push\.apple\.com$/,
  /^[\w-]+\.notify\.windows\.com$/,
];

/** Whether `endpoint` is an https address at one of the browsers' push services. */
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      PUSH_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

/** What the person started. The message names it. */
export type WatchKind = "catch_up" | "regenerate";

/** A browser's push address and the two keys its messages are sealed with. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushWatch extends PushTarget {
  run_id: string;
  kind: WatchKind;
}

/**
 * Starts a watch, or refreshes the keys of the one this browser already has for the run. False when
 * the run already has MAX_WATCHES_PER_RUN other browsers waiting: the cap is in the statement, so
 * two requests at once cannot both slip past it.
 */
export async function addPushWatch(
  sql: SqlClient,
  watch: PushWatch,
  now: number,
): Promise<boolean> {
  const write = async (): Promise<boolean> => {
    const rows = await sql.query(
      `insert into push_watches (run_id, endpoint, p256dh, auth, kind, created_at)
select $1, $2, $3, $4, $5, $6::timestamptz
where (select count(*) from push_watches where run_id = $1 and endpoint <> $2) < $7
on conflict (run_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
returning 1 as stored`,
      [
        watch.run_id,
        watch.endpoint,
        watch.p256dh,
        watch.auth,
        watch.kind,
        new Date(now).toISOString(),
        MAX_WATCHES_PER_RUN,
      ],
    );
    return rows.length > 0;
  };
  return withTable(sql, PUSH_SCHEMA_SQL, write);
}

/** Stops waiting: this browser no longer wants to be told about the run. */
export async function removePushWatch(
  sql: SqlClient,
  runId: string,
  endpoint: string,
): Promise<void> {
  try {
    await sql.query("delete from push_watches where run_id = $1 and endpoint = $2", [
      runId,
      endpoint,
    ]);
  } catch (error) {
    // No table yet means nothing is being waited for.
    if (!missingTable(error)) throw error;
  }
}

/** How a watched run ended, for the message. Cancelled and empty runs say nothing. */
export type WatchOutcome = "ready" | "failed";

export interface EndedWatch extends PushWatch {
  outcome: WatchOutcome;
  /** The id of the podcast the run made, when it made one. */
  podcast: string | null;
}

/**
 * The watches whose run has ended, with how. A run is known to have ended by its row in
 * `pipeline_runs` (written by the engine when a run ends, whatever its end: D221), matched on the
 * GitHub run id. A published run is "ready", a failed one "failed"; a run that ended with nothing to
 * publish, or that its starter cancelled, has no message, and its watch is dropped with the old ones.
 */
export async function endedPushWatches(sql: SqlClient): Promise<EndedWatch[]> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query(
      `select w.run_id, w.endpoint, w.p256dh, w.auth, w.kind, r.outcome, r.podcasts
from push_watches w
join pipeline_runs r on r.github_run_id = w.run_id
where r.outcome in ('published', 'failed')
order by w.created_at`,
    );
  } catch (error) {
    // Either table missing: no watch, or no run has been logged yet.
    if (missingTable(error)) return [];
    throw error;
  }
  const byWatch = new Map<string, EndedWatch>();
  for (const row of rows) {
    const key = `${String(row.run_id)} ${String(row.endpoint)}`;
    const published = row.outcome === "published";
    const podcasts = Array.isArray(row.podcasts) ? row.podcasts.map(String) : [];
    const seen = byWatch.get(key);
    // One run can leave several rows (a briefing and its edition): any published one makes it ready.
    if (seen && (seen.outcome === "ready" || !published)) continue;
    byWatch.set(key, {
      run_id: String(row.run_id),
      endpoint: String(row.endpoint),
      p256dh: String(row.p256dh),
      auth: String(row.auth),
      kind: row.kind === "regenerate" ? "regenerate" : "catch_up",
      outcome: published ? "ready" : "failed",
      podcast: published ? (podcasts[0] ?? null) : null,
    });
  }
  return [...byWatch.values()];
}

/** Deletes the watches that were sent, gone, or are not worth keeping. */
export async function deletePushWatches(
  sql: SqlClient,
  keys: readonly { run_id: string; endpoint: string }[],
): Promise<void> {
  if (keys.length === 0) return;
  await sql.query(
    `delete from push_watches w
using unnest($1::text[], $2::text[]) as gone(run_id, endpoint)
where w.run_id = gone.run_id and w.endpoint = gone.endpoint`,
    [keys.map((key) => key.run_id), keys.map((key) => key.endpoint)],
  );
}

/**
 * Drops the watches of runs that ended without a message (nothing to publish, cancelled) and any
 * older than WATCH_LIFETIME_MS. Returns how many went.
 */
export async function sweepPushWatches(sql: SqlClient, now: number): Promise<number> {
  try {
    const rows = await sql.query(
      `delete from push_watches w
where w.created_at < $1::timestamptz
  or exists (select 1 from pipeline_runs r
    where r.github_run_id = w.run_id and r.outcome not in ('published', 'failed'))
returning 1 as gone`,
      [new Date(now - WATCH_LIFETIME_MS).toISOString()],
    );
    return rows.length;
  } catch (error) {
    // `pipeline_runs` missing leaves the age rule for the next sweep.
    if (!missingTable(error)) throw error;
    const rows = await sql
      .query("delete from push_watches where created_at < $1::timestamptz returning 1 as gone", [
        new Date(now - WATCH_LIFETIME_MS).toISOString(),
      ])
      .catch((again: unknown) => {
        if (missingTable(again)) return [];
        throw again;
      });
    return rows.length;
  }
}

/** Most devices that may ask for the Daily and the Weekly: one person's phones and laptops, not a crowd. */
export const MAX_DEVICES = 20;

/** The scheduled podcasts a device can ask to hear about. */
export type ScheduledKind = "daily" | "weekly";

export interface PushDevice extends PushTarget {
  daily: boolean;
  weekly: boolean;
}

/**
 * Sets what this browser wants to hear about (the Daily, the Weekly), or refreshes its keys. False when
 * MAX_DEVICES other browsers already ask: the cap is in the statement, as the watches' is. A device
 * that wants neither is removed.
 */
export async function setPushDevice(
  sql: SqlClient,
  device: PushDevice,
  now: number,
): Promise<boolean> {
  if (!device.daily && !device.weekly) {
    await removePushDevice(sql, device.endpoint);
    return true;
  }
  const write = async (): Promise<boolean> => {
    const rows = await sql.query(
      `insert into push_devices (endpoint, p256dh, auth, daily, weekly, updated_at)
select $1, $2, $3, $4, $5, $6::timestamptz
where (select count(*) from push_devices where endpoint <> $1) < $7
on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
  daily = excluded.daily, weekly = excluded.weekly, updated_at = excluded.updated_at
returning 1 as stored`,
      [
        device.endpoint,
        device.p256dh,
        device.auth,
        device.daily,
        device.weekly,
        new Date(now).toISOString(),
        MAX_DEVICES,
      ],
    );
    return rows.length > 0;
  };
  return withTable(sql, PUSH_SCHEMA_SQL, write);
}

/** This browser no longer hears about the Daily or the Weekly. */
export async function removePushDevice(sql: SqlClient, endpoint: string): Promise<void> {
  try {
    await sql.query("delete from push_devices where endpoint = $1", [endpoint]);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

/** A scheduled podcast that has just been published and not yet announced. */
export interface NewScheduledRun {
  run_id: string;
  kind: ScheduledKind;
  /** The id of the digest it made, for the message's link. */
  podcast: string | null;
}

/** A run older than this is not news any more: the first sync after the keys exist stays quiet about old runs. */
const ANNOUNCE_WINDOW_MS = 6 * 3_600_000;

/**
 * Claims the Daily and Weekly runs that published since the last call, so each is announced once
 * whoever asks: the claim and the read are one statement, and a run is claimed whether or not any
 * device wants it (a device added later is not sent an old run). A regeneration (it replaces a
 * podcast), a dry run and a run of any other kind are not announced here: a person who asked for
 * one hears of it through a watch.
 */
export async function claimNewScheduledRuns(
  sql: SqlClient,
  now: number,
): Promise<NewScheduledRun[]> {
  try {
    const rows = await sql.query(
      `with claimed as (
  insert into push_announced (run_id, announced_at)
  select r.run_id, $1::timestamptz from pipeline_runs r
  where r.workflow = 'run' and r.outcome = 'published' and not r.dry_run and r.replaces is null
    and r.kind in ('daily', 'weekly') and r.finished_at > $2::timestamptz
  on conflict (run_id) do nothing
  returning run_id
)
select r.run_id, r.kind, r.podcasts from pipeline_runs r join claimed c on c.run_id = r.run_id`,
      [new Date(now).toISOString(), new Date(now - ANNOUNCE_WINDOW_MS).toISOString()],
    );
    return rows.map((row) => ({
      run_id: String(row.run_id),
      kind: row.kind === "weekly" ? "weekly" : "daily",
      podcast: Array.isArray(row.podcasts) && row.podcasts[0] ? String(row.podcasts[0]) : null,
    }));
  } catch (error) {
    // `pipeline_runs` or the claim table is not there yet: nothing has run, or no browser has asked.
    if (!missingTable(error)) throw error;
    for (const statement of PUSH_SCHEMA_SQL) await sql.query(statement);
    return [];
  }
}

/** The devices that asked to hear about this kind of run. */
export async function devicesFor(sql: SqlClient, kind: ScheduledKind): Promise<PushTarget[]> {
  try {
    const rows = await sql.query(
      `select endpoint, p256dh, auth from push_devices where ${kind === "weekly" ? "weekly" : "daily"}`,
    );
    return rows.map((row) => ({
      endpoint: String(row.endpoint),
      p256dh: String(row.p256dh),
      auth: String(row.auth),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}
