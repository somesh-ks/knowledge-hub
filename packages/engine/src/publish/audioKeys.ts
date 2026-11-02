import { createHash } from "node:crypto";
import { DigestId, EpisodeId } from "@singularity/core";

/**
 * The narration keys in Blob, apart from the client in blob.ts: the site's function imports these on
 * every page, and importing blob.ts there would load the Vercel Blob SDK (about 80 ms of a cold
 * start) for a few string functions.
 */

/** Prefix every narration lives under, so pruning can never touch other blobs in the store. */
export const AUDIO_PREFIX = "audio/";

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
