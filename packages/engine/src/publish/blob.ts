import { DigestId } from "@dispatch/core";
import { del, list, put } from "@vercel/blob";

/** Prefix every narration lives under, so pruning can never touch other blobs in the store. */
export const AUDIO_PREFIX = "audio/";

/**
 * Edge and browser cache lifetime. A narration is written once and only replaced on regeneration,
 * and Vercel propagates an overwrite to the CDN within a minute, so a week keeps replays cheap
 * without pinning a stale file for the default month.
 */
export const DEFAULT_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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

/**
 * Wrap @vercel/blob with the token passed explicitly, so it never depends on ambient process.env.
 * Public access with a fixed pathname and overwrite allowed: the URL stays stable across reruns.
 */
export function createVercelBlobClient(token: string): BlobClient {
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
          token,
        },
      );
      return { url: result.url, pathname: result.pathname };
    },
    async del(pathnames) {
      await del([...pathnames], { token });
    },
    async list(options) {
      const page = await list({
        prefix: options.prefix,
        ...(options.cursor ? { cursor: options.cursor } : {}),
        token,
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

/** Blob key for a digest's narration: audio/<digest id>.mp3 */
export function audioKey(digestId: string): string {
  return `${AUDIO_PREFIX}${DigestId.parse(digestId)}.mp3`;
}

export interface UploadAudioInput {
  digestId: string;
  audio: Uint8Array;
  cacheControlMaxAge?: number;
}

/** Upload one narration and return its public URL. Re-uploading the same digest overwrites. */
export async function uploadAudio(client: BlobClient, input: UploadAudioInput): Promise<string> {
  if (input.audio.byteLength === 0) throw new Error("Refusing to upload empty audio");
  const result = await client.put(audioKey(input.digestId), input.audio, {
    contentType: "audio/mpeg",
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

export async function deleteAudio(client: BlobClient, digestId: string): Promise<void> {
  await client.del([audioKey(digestId)]);
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
 * Delete narrations uploaded more than `olderThanDays` ago. Only audio/*.mp3 is considered. The
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
      const isNarration = blob.pathname.startsWith(AUDIO_PREFIX) && blob.pathname.endsWith(".mp3");
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
