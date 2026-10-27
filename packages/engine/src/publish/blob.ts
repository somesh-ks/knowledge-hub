import { createHash } from "node:crypto";
import { DigestId, EpisodeId } from "@singularity/core";
import { del, list, put } from "@vercel/blob";
import { OPUS_CONTENT_TYPE } from "../audio/transcode.js";

/** Prefix every narration lives under, so pruning can never touch other blobs in the store. */
export const AUDIO_PREFIX = "audio/";

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
}

export interface BlobPutResult {
  url: string;
  pathname: string;
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

/** A long-lived read-write token, or the short-lived OIDC token and store id Vercel issues. */
export type BlobAuth = string | { oidcToken: string; storeId: string };

/**
 * Wrap @vercel/blob with credentials passed explicitly, so it never depends on ambient process.env.
 * Public access with a fixed pathname and overwrite allowed: the URL stays stable across reruns.
 */
export function createVercelBlobClient(auth: BlobAuth): BlobClient {
  const credentials = typeof auth === "string" ? { token: auth } : auth;
  return {
    async put(pathname, body, options) {
      const result = await put(
        pathname,
        Buffer.from(body.buffer, body.byteOffset, body.byteLength),
        {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: options.contentType,
          cacheControlMaxAge: options.cacheControlMaxAge,
          ...credentials,
        },
      );
      return { url: result.url, pathname: result.pathname };
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

/** The short content hash that versions a narration's key. */
export function audioVersion(audio: Uint8Array): string {
  return createHash("sha256").update(audio).digest("hex").slice(0, 12);
}

/**
 * Blob key for a digest's narration: audio/<digest id>.<version>.mp3. Without a version it is the
 * unversioned audio/<digest id>.mp3 that records written before versioning still point at.
 */
export function audioKey(digestId: string, version?: string): string {
  const id = DigestId.parse(digestId);
  return version === undefined ? `${AUDIO_PREFIX}${id}.mp3` : `${AUDIO_PREFIX}${id}.${version}.mp3`;
}

/**
 * Blob key for a digest's Opus narration: audio/<digest id>.<version>.m4a, a new URL for every
 * recording like the MP3's; without a version, the audio/<digest id>.m4a of the first Opus uploads.
 */
export function audioOpusKey(digestId: string, version?: string): string {
  const id = DigestId.parse(digestId);
  return version === undefined ? `${AUDIO_PREFIX}${id}.m4a` : `${AUDIO_PREFIX}${id}.${version}.m4a`;
}

/**
 * Blob key for a podcast episode's one Opus file: audio/<episode id>/episode.<version>.m4a. The
 * version comes from audioVersion like every other narration's; the site cannot read the file, so
 * the caller hashes what it can name (the turn files' own paths) and the key follows the script.
 */
export function episodeOpusKey(episodeId: string, version: string): string {
  const id = EpisodeId.parse(episodeId);
  return `${AUDIO_PREFIX}${id}/episode.${version}.m4a`;
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

export interface PruneResult {
  deleted: string[];
  kept: number;
}

export interface PruneAudioInput {
  olderThanDays: number;
  now: Date;
}

/**
 * Delete narrations uploaded more than `olderThanDays` ago. Only audio/*.mp3 and .m4a are considered. The
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
      const isNarration =
        blob.pathname.startsWith(AUDIO_PREFIX) &&
        (blob.pathname.endsWith(".mp3") || blob.pathname.endsWith(".m4a"));
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
