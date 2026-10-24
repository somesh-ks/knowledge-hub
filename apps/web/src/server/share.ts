import { createHash } from "node:crypto";
import { mapConcurrent } from "@dispatch/engine/concurrency";
import type { SqlClient } from "@dispatch/engine/config-paths";
import {
  activeShareLink,
  createShareLink,
  linkWorks,
  readShareLink,
  revokeGrantedLink,
  revokeShareLinks,
  type SharedSegment,
  type ShareLink,
  startSharedPlay,
} from "@dispatch/engine/share-store";
import {
  NOT_STORED_COPY,
  SHARE_EXPIRY_DAYS,
  SHARE_MONTHLY_BYTES,
  SHARE_PLAYS_PER_LINK,
} from "../lib/share";
import type { NarrateLookupResponse } from "../types/contracts";
import type { BlobEntry } from "./blobStore";
import type { DatabaseCall } from "./database";
import { isSameOrigin } from "./generate";
import type { ApiResult } from "./http";
import { parseDigestId } from "./narrate";
import { segmentAudio } from "./narrateSegments";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";

/**
 * Share links (D153): `POST /api/share` makes an item's link (or answers the one it has), `DELETE
 * /api/share` stops it, `POST /api/share-play` starts a play on the listen page, and the page itself
 * opens a link with `openListenLink`. The token is the link's random 128-bit id, looked up in Neon:
 * nothing to set up and nothing for a listener to enter (D153, D160). A token of the wrong shape is
 * refused before the rate counter or the database is asked; a well-formed guess costs one bucket
 * count and one indexed read, and the CDN's five-minute copy absorbs repeat page hits. The links and
 * their counts live in Neon (engine/store/shareStore.ts).
 */

/** Bytes of the random link id: 128 bits. */
const ID_BYTES = 16;
/** base64url of 16 bytes: 22 characters. */
const TOKEN = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((ID_BYTES * 4) / 3)}}$`);
/** Heads at once while checking an item's files: a briefing has 11 to 16. */
const HEADS_AT_ONCE = 4;
const DAY_MS = 86_400_000;

/** A link id, from the platform's random source (the tests pass their own). Also its token. */
export const newLinkId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(ID_BYTES))).toString("base64url");

/**
 * The link id a token names, or null when it is not one we could have made. Asks nothing of the
 * database. Only the canonical spelling passes: the last of 22 characters carries 4 spare bits, so
 * other spellings decode to the same id.
 */
export function tokenId(token: unknown): string | null {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  return Buffer.from(token, "base64url").toString("base64url") === token ? token : null;
}

/** What `database` answers when Neon is not configured, down or slow. */
const UNAVAILABLE: unique symbol = Symbol("unavailable");

/** Runs `work` on Neon, or answers UNAVAILABLE when the store cannot. */
const ask = <T>(
  deps: { database: DatabaseCall },
  work: (sql: SqlClient) => Promise<T>,
): Promise<T | typeof UNAVAILABLE> => deps.database<T | typeof UNAVAILABLE>(work, UNAVAILABLE);

export interface ShareDeps {
  /** Neon, guarded (server/database.ts): its fallback stands for a store that cannot answer. */
  database: DatabaseCall;
  /** The shared per-minute cap of the route (D150): 0 to go ahead, else the seconds to wait. */
  burst: () => Promise<number>;
  now: () => number;
  /**
   * The item's audio files as the narration lookup names them now, from the same digests and
   * episodes the listen page reads; null for no such item. Asks no store anything.
   */
  candidates: (itemId: string) => Promise<ShareCandidate[] | null>;
  log?: (message: string) => void;
}

export interface MakeDeps extends ShareDeps {
  /** A new link id; random in production. */
  newId?: () => string;
  /** The Blob store's metadata for one file (a SIMPLE operation), null when nothing is there. */
  head: ((pathname: string) => Promise<BlobEntry | null>) | null;
  /** Items lately found not fully stored, so a retried Share heads nothing (createNotStoredMemo). */
  notStored?: NotStoredMemo;
}

/** How long "not fully stored" is believed: retries in this window cost no Blob operation. */
export const NOT_STORED_MEMO_MS = 2 * 60_000;

/** Remembers, per function instance, which item at which fingerprint was not fully stored. */
export interface NotStoredMemo {
  has: (item: string, source: string, now: number) => boolean;
  add: (item: string, source: string, now: number) => void;
}

export function createNotStoredMemo(ttlMs = NOT_STORED_MEMO_MS): NotStoredMemo {
  const held = new Map<string, { source: string; until: number }>();
  return {
    has(item, source, now) {
      const entry = held.get(item);
      if (entry && entry.until <= now) held.delete(item);
      return entry !== undefined && entry.until > now && entry.source === source;
    },
    add(item, source, now) {
      held.set(item, { source, until: now + ttlMs });
    },
  };
}

/**
 * What a link is made from: a fingerprint of the files the lookup names, and their lengths of text.
 * A segment's name carries the hash of its words and voice, so a Regenerate changes it.
 */
export function sourceOf(candidates: readonly ShareCandidate[]): string {
  const names = candidates.map((candidate) => `${candidate.pathname}:${candidate.characters}`);
  return createHash("sha256").update(names.join("\n")).digest("base64url").slice(0, 22);
}

/**
 * Whether the item still is what `link` was made from: false when it is gone or was regenerated.
 * An item the lookup cannot name files for right now (no store address) is not judged.
 */
async function stillCurrent(link: ShareLink, deps: ShareDeps): Promise<boolean> {
  let candidates: ShareCandidate[] | null;
  try {
    candidates = await deps.candidates(link.item_id);
  } catch {
    return true;
  }
  if (candidates === null) return false;
  return candidates.length === 0 || sourceOf(candidates) === link.source;
}

/** One file an item plays, where the lookup says it would be. */
export interface ShareCandidate {
  pathname: string;
  /** Spoken characters, for a duration when the store reports no size. */
  characters: number;
}

type Body = Record<string, unknown>;
export type ShareResult = ApiResult<Body>;

const invalid: ShareResult = { status: 400, body: { status: 400, error: "invalid_request" } };
const unavailable: ShareResult = { status: 503, body: { status: 503, error: "unavailable" } };
const notFound: ShareResult = { status: 404, body: { status: 404, error: "not_found" } };
const gone: ShareResult = {
  status: 410,
  body: { status: 410, error: "gone", message: "This link has stopped working." },
};
const notStored: ShareResult = {
  status: 409,
  body: { status: 409, error: "not_stored", message: NOT_STORED_COPY },
};

export interface ShareRequest {
  method: "POST" | "DELETE";
  bodyText: string;
  origin: string | null;
  expectedOrigin: string;
}

/** `{"item": "<briefing or episode id>"}`, or null. */
function parseItem(bodyText: string): string | null {
  try {
    const body = JSON.parse(bodyText) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    return parseDigestId((body as Body).item);
  } catch {
    return null;
  }
}

/**
 * The item's files that the lookup names, in playing order: its one whole file when the build has
 * one, else each segment. Only addresses in the Blob store count; anything else cannot be shared.
 * Null when the lookup found no such item; empty when nothing of it can be shared.
 */
export function shareCandidates(
  lookup: NarrateLookupResponse,
  publicBase: string | null,
): ShareCandidate[] | null {
  if (lookup.status !== 200) return null;
  if (publicBase === null) return [];
  const inStore = (url: string): string | null =>
    url.startsWith(`${publicBase}/`) ? url.slice(publicBase.length + 1) : null;
  const whole = lookup.audio ? inStore(lookup.audio.url) : null;
  if (whole) {
    const characters = lookup.segments.reduce((sum, segment) => sum + segment.characters, 0);
    return [{ pathname: whole, characters }];
  }
  const files: ShareCandidate[] = [];
  for (const segment of lookup.segments) {
    const pathname = segment.audio ? inStore(segment.audio.url) : null;
    if (!pathname) return [];
    files.push({ pathname, characters: segment.characters });
  }
  return files;
}

/** Heads every file, a few at a time; null when one is missing. */
async function storedFiles(
  candidates: readonly ShareCandidate[],
  head: (pathname: string) => Promise<BlobEntry | null>,
): Promise<{ segments: SharedSegment[]; bytes: number } | null> {
  let missing = false;
  // Once one file is missing the rest are not asked for: each head is a Blob operation.
  const found = await mapConcurrent(candidates, HEADS_AT_ONCE, async (candidate) => {
    if (missing) return null;
    const entry = await head(candidate.pathname);
    const audio = segmentAudio(entry, candidate.characters);
    if (audio === null) missing = true;
    return audio === null ? null : { url: audio.url, duration_ms: audio.duration_ms, entry };
  });
  if (missing) return null;
  const segments = found.flatMap((file) =>
    file ? [{ url: file.url, duration_ms: file.duration_ms }] : [],
  );
  const bytes = found.reduce((sum, file) => sum + (file?.entry?.size ?? 0), 0);
  return { segments, bytes };
}

function made(link: ShareLink): ShareResult {
  return {
    status: 200,
    body: { status: 200, token: link.id, expires_at: link.expires_at },
  };
}

/** POST /api/share makes or reuses the item's link; DELETE /api/share stops it. */
export async function handleShare(input: ShareRequest, deps: MakeDeps): Promise<ShareResult> {
  const log = deps.log ?? (() => {});
  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const item = parseItem(input.bodyText);
  if (item === null) return invalid;
  const wait = await deps.burst();
  if (wait > 0) return cooldownRefusal(wait);
  const now = deps.now();

  if (input.method === "DELETE") {
    const stopped = await ask(deps, (sql) => revokeShareLinks(sql, item, now));
    return stopped === UNAVAILABLE ? unavailable : { status: 200, body: { status: 200, stopped } };
  }

  const candidates = await deps.candidates(item);
  if (candidates === null) return notFound;
  const source = sourceOf(candidates);

  // A link made from the item as it is now is answered again: no store operation, one query. One
  // made before a Regenerate would play the old audio under the new text, so it is stopped.
  const existing = await ask(deps, (sql) => activeShareLink(sql, item, now));
  if (existing === UNAVAILABLE) return unavailable;
  if (existing && (candidates.length === 0 || existing.source === source)) {
    return made(existing);
  }
  if (existing) {
    log(`share ${item}: the item changed since its link was made; stopping that link`);
    const stopped = await ask(deps, (sql) => revokeShareLinks(sql, item, now));
    if (stopped === UNAVAILABLE) return unavailable;
  }

  if (candidates.length === 0 || deps.head === null) return notStored;
  // A Share retried on an item whose audio is still being made heads nothing for a while.
  if (deps.notStored?.has(item, source, now)) return notStored;
  let stored: Awaited<ReturnType<typeof storedFiles>>;
  try {
    stored = await storedFiles(candidates, deps.head);
  } catch (error) {
    log(`share ${item}: the store could not be read: ${describeError(error, [])}`);
    return unavailable;
  }
  if (stored === null) {
    deps.notStored?.add(item, source, now);
    return notStored;
  }
  const files = stored;
  const id = (deps.newId ?? newLinkId)();
  const link = await ask(deps, (sql) =>
    createShareLink(sql, {
      id,
      itemId: item,
      now,
      expiresAt: now + SHARE_EXPIRY_DAYS * DAY_MS,
      bytes: files.bytes,
      segments: files.segments,
      source,
    }),
  );
  return link === UNAVAILABLE ? unavailable : made(link);
}

export interface PlayRequest {
  bodyText: string;
  origin: string | null;
  expectedOrigin: string;
}

/** `{"token": "..."}`, or undefined when the body is not that shape. */
function parseToken(bodyText: string): unknown {
  try {
    const body = JSON.parse(bodyText) as unknown;
    return typeof body === "object" && body !== null ? (body as Body).token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /api/share-play: one play start on the listen page. The link must work, be under its cap
 * and the month under its budget; then its plays go up by one, the month's bytes by the item's
 * size, and the answer carries the files to play in order.
 */
export async function handleSharePlay(input: PlayRequest, deps: ShareDeps): Promise<ShareResult> {
  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const id = tokenId(parseToken(input.bodyText));
  if (id === null) return notFound;
  const wait = await deps.burst();
  if (wait > 0) return cooldownRefusal(wait);
  const now = deps.now();
  const grant = await ask(deps, (sql) =>
    startSharedPlay(sql, id, now, {
      playsPerLink: SHARE_PLAYS_PER_LINK,
      monthlyBytes: SHARE_MONTHLY_BYTES,
    }),
  );
  if (grant === UNAVAILABLE) return unavailable;
  if (grant.granted) {
    // Checked after the grant, so a granted play stays one round trip; a link whose item was
    // deleted or regenerated since is stopped and its play handed back.
    if (!(await stillCurrent(grant.link, deps))) {
      const revoked = await ask(deps, (sql) => revokeGrantedLink(sql, id, now));
      return revoked === UNAVAILABLE ? unavailable : gone;
    }
    return { status: 200, body: { status: 200, segments: grant.link.segments } };
  }
  switch (grant.reason) {
    case "not_found":
      return notFound;
    case "gone":
      return gone;
    case "link_limit":
      return {
        status: 429,
        body: { status: 429, error: "link_limit", message: "This link has been played its limit." },
      };
    case "month_limit":
      return {
        status: 429,
        body: {
          status: 429,
          error: "month_limit",
          message: "Shared listening is paused until next month.",
        },
      };
  }
  return notFound;
}

/** What the listen page renders for a token. */
export type ListenOpen =
  | { status: 200; link: ShareLink }
  | { status: 404 | 410 | 429 | 503; reason: string };

/**
 * The link a listen page's token opens. A token of the wrong shape is answered 404 before the cap or
 * the database is asked, an unknown one 404 after the lookup; a revoked or expired link is 410.
 */
export async function openListenLink(token: string, deps: ShareDeps): Promise<ListenOpen> {
  const id = tokenId(token);
  if (id === null) return { status: 404, reason: "not_found" };
  if ((await deps.burst()) > 0) return { status: 429, reason: "cooldown" };
  const link = await ask(deps, (sql) => readShareLink(sql, id));
  if (link === UNAVAILABLE) return { status: 503, reason: "unavailable" };
  if (link === null) return { status: 404, reason: "not_found" };
  if (!linkWorks(link, deps.now())) return { status: 410, reason: "gone" };
  // The page only reads; the next play stops a link whose item changed.
  if (!(await stillCurrent(link, deps))) return { status: 410, reason: "gone" };
  return { status: 200, link };
}
