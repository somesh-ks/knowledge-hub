import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  head,
  list,
  put,
} from "@vercel/blob";
import { OPUS_CONTENT_TYPE } from "../audio/transcode.js";
import { AUDIO_PREFIX, audioKey, audioOpusKey, audioVersion } from "./audioKeys.js";

export {
  AUDIO_PREFIX,
  audioKey,
  audioOpusKey,
  audioVersion,
  episodeOpusKey,
} from "./audioKeys.js";

/**
 * Cache lifetime of a narration. Its key carries a hash of the bytes (audioKey), so a regenerated
 * narration is a new URL and the old one never changes: a year is safe (D173, plan section 20,
 * criterion 6).
 */
export const DEFAULT_CACHE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const DAY_MS = 86_400_000;
const DELETE_BATCH = 50;

export interface BlobPutOptions {
  contentType: string;
  cacheControlMaxAge: number;
  /** Write only if the blob's ETag still is this one; a mismatch throws (see isPreconditionFailed). */
  ifMatch?: string;
  /** Write only if nothing is stored at the path; a blob already there throws (see isAlreadyExists). */
  createOnly?: boolean;
}

export interface BlobPutResult {
  url: string;
  pathname: string;
  /** The ETag of what was just written, when the store reports it. */
  etag?: string;
}

export interface BlobListItem {
  url: string;
  pathname: string;
  uploadedAt: Date;
  size: number;
}

export interface BlobListPage {
  blobs: BlobListItem[];
  cursor?: string;
  hasMore: boolean;
}

/** The slice of Vercel Blob this engine uses. Tests inject a fake; production wraps @vercel/blob. */
export interface BlobClient {
  put(pathname: string, body: Uint8Array, options: BlobPutOptions): Promise<BlobPutResult>;
  del(pathnames: readonly string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<BlobListPage>;
}

/** A public URL's text and the ETag of the copy that answered. */
export interface TaggedText {
  text: string;
  etag: string;
}

/** What a conditional write needs on top of BlobClient: a blob's URL and ETag, or null when absent. */
export interface ConditionalBlobClient extends BlobClient {
  head(pathname: string): Promise<{ url: string; etag: string } | null>;
  /** The text at a public URL, or null on 404. The CDN may answer with an older copy: use readCurrent. */
  fetchTagged(url: string): Promise<TaggedText | null>;
}

export interface StoreClock {
  now(): number;
  pause(ms: number): Promise<void>;
}

const realClock: StoreClock = {
  now: () => Date.now(),
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** How long a read waits for the CDN to catch up with a write. Vercel documents up to 60 s. */
export const CURRENT_WAIT_MS = 90_000;
const CURRENT_POLL_MS = 5_000;

const bareTag = (etag: string): string => etag.replace(/^W\//, "").replaceAll('"', "");

/**
 * A changing blob's current text. After an overwrite the CDN keeps serving its old copy for up to
 * a minute, and a new query string does not get past it: on 11-04 a `?t=` URL nobody had asked for
 * answered HIT with age 1912, and an audio job read a manifest 39 s old that lacked the episode
 * just saved. Its ETag was head()'s, so a write on top of it would have passed the ETag check and
 * dropped that episode. head() is current, so the read waits until the copy that answers carries
 * head()'s ETag. `known` is a copy this job wrote itself: when head() still reports it, nothing is
 * fetched.
 */
export async function readCurrent(
  client: ConditionalBlobClient,
  pathname: string,
  known?: TaggedText,
  clock: StoreClock = realClock,
): Promise<{ url: string; etag: string; text: string } | null> {
  const deadline = clock.now() + CURRENT_WAIT_MS;
  for (;;) {
    const found = await client.head(pathname);
    if (found === null) return null;
    if (known !== undefined && bareTag(known.etag) === bareTag(found.etag)) {
      return { url: found.url, etag: found.etag, text: known.text };
    }
    const read = await client.fetchTagged(found.url);
    if (read !== null && bareTag(read.etag) === bareTag(found.etag)) {
      return { url: found.url, etag: found.etag, text: read.text };
    }
    if (clock.now() >= deadline) {
      throw new Error(
        `${pathname}: the CDN still serves an older copy after ${CURRENT_WAIT_MS / 1000} s`,
      );
    }
    await clock.pause(CURRENT_POLL_MS);
  }
}

/** True when a write was refused because the blob changed since its ETag was read (D300). */
export function isPreconditionFailed(error: unknown): boolean {
  return error instanceof BlobPreconditionFailedError;
}

/** True when a create-only write found a blob already stored there. The store answers with a plain error naming it. */
export function isAlreadyExists(error: unknown): boolean {
  return error instanceof BlobError && /already exists/i.test(error.message);
}

/** A long-lived read-write token, or the short-lived OIDC token and store id Vercel issues. */
export type BlobAuth = string | { oidcToken: string; storeId: string };

/**
 * Wrap @vercel/blob with credentials passed explicitly, so it never depends on ambient process.env.
 * Public access with a fixed pathname and overwrite allowed: the URL stays stable across reruns.
 */
export function createVercelBlobClient(auth: BlobAuth): ConditionalBlobClient {
  const credentials = typeof auth === "string" ? { token: auth } : auth;
  return {
    async put(pathname, body, options) {
      const result = await put(
        pathname,
        Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: options.createOnly !== true,
          contentType: options.contentType,
          cacheControlMaxAge: options.cacheControlMaxAge,
          ...(options.ifMatch !== undefined ? { ifMatch: options.ifMatch } : {}),
          ...credentials,
        },
      );
      return { url: result.url, pathname: result.pathname, etag: result.etag };
    },
    async fetchTagged(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
      return { text: await res.text(), etag: res.headers.get("etag") ?? "" };
    },
    async head(pathname) {
      try {
        const result = await head(pathname, { ...credentials });
        return { url: result.url, etag: result.etag };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },
    async del(pathnames) {
      await del([...pathnames], { ...credentials });
    },
    async list(options) {
      const page = await list({
        prefix: options.prefix,
        ...(options.cursor ? { cursor: options.cursor } : {}),
        ...credentials,
      });
      return {
        blobs: page.blobs.map((blob) => ({
          url: blob.url,
          pathname: blob.pathname,
          uploadedAt: blob.uploadedAt,
          size: blob.size,
        })),
        ...(page.cursor ? { cursor: page.cursor } : {}),
        hasMore: page.hasMore,
      };
    },
  };
}

export interface UploadAudioInput {
  digestId: string;
  audio: Uint8Array;
  cacheControlMaxAge?: number;
}

/** Upload one narration and return its public URL. Re-uploading the same digest overwrites. */
export async function uploadAudio(client: BlobClient, input: UploadAudioInput): Promise<string> {
  return putNarration(
    client,
    audioKey(input.digestId, audioVersion(input.audio)),
    "audio/mpeg",
    input,
  );
}

/** Upload a digest's Opus narration beside its MP3 and return its public URL. */
export async function uploadOpusAudio(
  client: BlobClient,
  input: UploadAudioInput,
): Promise<string> {
  return putNarration(
    client,
    audioOpusKey(input.digestId, audioVersion(input.audio)),
    OPUS_CONTENT_TYPE,
    input,
  );
}

async function putNarration(
  client: BlobClient,
  key: string,
  contentType: string,
  input: UploadAudioInput,
): Promise<string> {
  if (input.audio.byteLength === 0) throw new Error("Refusing to upload empty audio");
  const result = await client.put(key, input.audio, {
    contentType,
    cacheControlMaxAge: input.cacheControlMaxAge ?? DEFAULT_CACHE_MAX_AGE_SECONDS,
  });
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    throw new Error("Blob upload returned a URL that is not valid");
  }
  if (url.protocol !== "https:") throw new Error("Blob upload returned a URL that is not https");
  return result.url;
}

/** Narrations and what travels with them: word marks (.marks.json) and an episode's Opus manifest (.json). */
const PRUNABLE = /(\.mp3|\.m4a|\.marks\.json|\/episode\.[^/]+\.json)$/;

/** Pruning lists the whole audio/ prefix, one Blob operation per page, and 120-day-old files need no daily sweep. */
export const isPruneDay = (now: Date): boolean => now.getUTCDay() === 0;

export interface PruneResult {
  deleted: string[];
  kept: number;
}

export interface PruneAudioInput {
  olderThanDays: number;
  now: Date;
}

/**
 * Delete narrations uploaded more than `olderThanDays` ago. Only audio/* narrations (.mp3, .m4a) and their .json companions are considered. The
 * digests keep their audio fields, so a pruned digest plays as "audio unavailable" until rebuilt.
 */
export async function pruneAudio(client: BlobClient, input: PruneAudioInput): Promise<PruneResult> {
  if (!Number.isInteger(input.olderThanDays) || input.olderThanDays < 1) {
    throw new Error("Prune age must be a whole number of days, at least 1");
  }
  const cutoff = input.now.getTime() - input.olderThanDays * DAY_MS;
  const stale: string[] = [];
  let kept = 0;
  let cursor: string | undefined;
  do {
    const page = await client.list({ prefix: AUDIO_PREFIX, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) {
      const isNarration = blob.pathname.startsWith(AUDIO_PREFIX) && PRUNABLE.test(blob.pathname);
      if (isNarration && blob.uploadedAt.getTime() < cutoff) stale.push(blob.pathname);
      else kept++;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);

  for (let index = 0; index < stale.length; index += DELETE_BATCH) {
    await client.del(stale.slice(index, index + DELETE_BATCH));
  }
  return { deleted: stale, kept };
}
