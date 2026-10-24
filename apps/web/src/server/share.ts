import { createHmac, timingSafeEqual } from "node:crypto";
import type { SqlClient } from "@dispatch/engine/config-paths";
import {
  activeShareLink,
  createShareLink,
  linkWorks,
  readShareLink,
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
import { estimateDurationMs } from "./narrateSegments";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";

/**
 * Share links (D153): `POST /api/share` makes an item's link (or answers the one it has), `DELETE
 * /api/share` stops it, `POST /api/share-play` starts a play on the listen page, and the page itself
 * opens a link with `openListenLink`. The token is a random link id and an HMAC of it under
 * SHARE_SECRET, so a token nobody made is refused before any database call: a scanner costs a
 * function run and nothing more. The links and their counts live in Neon (engine/store/shareStore.ts).
 */

/** Bytes of the random link id and of the HMAC kept in the token: 128 bits each. */
const ID_BYTES = 16;
const MAC_BYTES = 16;
/** base64url of 16 bytes is 22 characters, so a token is 45 characters with its dot. */
const PART = `[A-Za-z0-9_-]{${Math.ceil((ID_BYTES * 4) / 3)}}`;
const TOKEN = new RegExp(`^(${PART})\\.(${PART})$`);
/** A secret shorter than this is treated as unset, as CRON_SECRET's is. */
const MIN_SECRET_CHARS = 16;
/** Heads at once while checking an item's files: a briefing has 11 to 16. */
const HEADS_AT_ONCE = 4;
const DAY_MS = 86_400_000;

/** SHARE_SECRET, or null when it is unset or too short to be one. Never logged. */
export function readShareSecret(env: { SHARE_SECRET?: string | undefined }): string | null {
  const value = env.SHARE_SECRET?.trim();
  return value && value.length >= MIN_SECRET_CHARS ? value : null;
}

const mac = (id: string, secret: string): Buffer =>
  createHmac("sha256", secret).update(id).digest().subarray(0, MAC_BYTES);

/** A link id, from the platform's random source (the tests pass their own). */
export const newLinkId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(ID_BYTES))).toString("base64url");

/** The token for link `id`: the id, a dot and the id's HMAC. */
export const signToken = (id: string, secret: string): string =>
  `${id}.${mac(id, secret).toString("base64url")}`;

/** The link id a token names, or null when its HMAC is not ours. Asks nothing of the database. */
export function verifyToken(token: unknown, secret: string): string | null {
  if (typeof token !== "string") return null;
  const match = TOKEN.exec(token);
  if (!match?.[1] || !match[2]) return null;
  // Compared as text, not decoded bytes: the last of 22 base64url characters carries 4 spare bits,
  // so a decoded compare took several spellings of one HMAC as the same token.
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(mac(match[1], secret).toString("base64url"));
  return given.length === expected.length && timingSafeEqual(given, expected) ? match[1] : null;
}

/** What `database` answers when Neon is not configured, down or slow. */
const UNAVAILABLE: unique symbol = Symbol("unavailable");

/** Runs `work` on Neon, or answers UNAVAILABLE when the store cannot. */
const ask = <T>(
  deps: { database: DatabaseCall },
  work: (sql: SqlClient) => Promise<T>,
): Promise<T | typeof UNAVAILABLE> => deps.database<T | typeof UNAVAILABLE>(work, UNAVAILABLE);

export interface ShareDeps {
  /** SHARE_SECRET as read by `readShareSecret`: null answers "not set up". */
  secret: string | null;
  /** Neon, guarded (server/database.ts): its fallback stands for a store that cannot answer. */
  database: DatabaseCall;
  /** The shared per-minute cap of the route (D150): 0 to go ahead, else the seconds to wait. */
  burst: () => Promise<number>;
  now: () => number;
  log?: (message: string) => void;
}

export interface MakeDeps extends ShareDeps {
  /** A new link id; random in production. */
  newId?: () => string;
  /** The item's audio files as the narration lookup names them, or null for no such item. */
  candidates: (itemId: string) => Promise<ShareCandidate[] | null>;
  /** The Blob store's metadata for one file (a SIMPLE operation), null when nothing is there. */
  head: ((pathname: string) => Promise<BlobEntry | null>) | null;
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
const notSetUp: ShareResult = {
  status: 503,
  body: { status: 503, error: "not_set_up", message: "Sharing is not set up on this site yet." },
};
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
  const entries: (BlobEntry | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  let missing = false;
  const worker = async () => {
    while (next < candidates.length && !missing) {
      const index = next;
      next += 1;
      const candidate = candidates[index];
      if (!candidate) continue;
      const entry = await head(candidate.pathname);
      if (entry === null || !entry.url.startsWith("https://")) missing = true;
      entries[index] = entry;
    }
  };
  await Promise.all(Array.from({ length: HEADS_AT_ONCE }, worker));
  if (missing) return null;
  const segments = entries.map((entry, index) => ({
    url: entry?.url ?? "",
    duration_ms: estimateDurationMs(entry?.size ?? 0, candidates[index]?.characters ?? 0),
  }));
  const bytes = entries.reduce((sum, entry) => sum + (entry?.size ?? 0), 0);
  return { segments, bytes };
}

function made(link: ShareLink, secret: string): ShareResult {
  return {
    status: 200,
    body: { status: 200, token: signToken(link.id, secret), expires_at: link.expires_at },
  };
}

/** POST /api/share makes or reuses the item's link; DELETE /api/share stops it. */
export async function handleShare(input: ShareRequest, deps: MakeDeps): Promise<ShareResult> {
  const log = deps.log ?? (() => {});
  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const item = parseItem(input.bodyText);
  if (item === null) return invalid;
  const secret = deps.secret;
  if (secret === null) return notSetUp;
  const wait = await deps.burst();
  if (wait > 0) return cooldownRefusal(wait);
  const now = deps.now();

  if (input.method === "DELETE") {
    const stopped = await ask(deps, (sql) => revokeShareLinks(sql, item, now));
    return stopped === UNAVAILABLE ? unavailable : { status: 200, body: { status: 200, stopped } };
  }

  // A link that works is answered again: no store operation, one query.
  const existing = await ask(deps, (sql) => activeShareLink(sql, item, now));
  if (existing === UNAVAILABLE) return unavailable;
  if (existing) return made(existing, secret);

  const candidates = await deps.candidates(item);
  if (candidates === null) return notFound;
  if (candidates.length === 0 || deps.head === null) return notStored;
  let stored: Awaited<ReturnType<typeof storedFiles>>;
  try {
    stored = await storedFiles(candidates, deps.head);
  } catch (error) {
    log(`share ${item}: the store could not be read: ${describeError(error, [])}`);
    return unavailable;
  }
  if (stored === null) return notStored;
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
    }),
  );
  return link === UNAVAILABLE ? unavailable : made(link, secret);
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
  const secret = deps.secret;
  if (secret === null) return notSetUp;
  const id = verifyToken(parseToken(input.bodyText), secret);
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
 * The link a listen page's token opens. A token with a bad HMAC is answered 404 before the cap or
 * the database is asked; a revoked or expired link is 410.
 */
export async function openListenLink(token: string, deps: ShareDeps): Promise<ListenOpen> {
  const secret = deps.secret;
  if (secret === null) return { status: 503, reason: "not_set_up" };
  const id = verifyToken(token, secret);
  if (id === null) return { status: 404, reason: "not_found" };
  if ((await deps.burst()) > 0) return { status: 429, reason: "cooldown" };
  const link = await ask(deps, (sql) => readShareLink(sql, id));
  if (link === UNAVAILABLE) return { status: 503, reason: "unavailable" };
  if (link === null) return { status: 404, reason: "not_found" };
  if (!linkWorks(link, deps.now())) return { status: 410, reason: "gone" };
  return { status: 200, link };
}
