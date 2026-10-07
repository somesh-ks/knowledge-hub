import { createHash } from "node:crypto";
import {
  DEFAULT_OUTPUT_FORMAT,
  durationFromMp3Bytes,
  type SpokenSegment,
} from "@dispatch/engine/audio";
import type { NarrationSegment } from "../types/contracts";
import type { BlobEntry } from "./blobStore";
import { MS_PER_CHARACTER } from "./config";

/**
 * Where a narrated segment lives, and how the store is read back into segments.
 *
 * A segment is stored at
 *
 *   audio/<digest>/seg/<key>.<hash>.mp3
 *
 * The hash covers the text, the voice and the model, so the name can be worked out from the digest
 * alone. That is what keeps the store cheap: a request for one segment finds out whether it exists
 * with a head, never a listing, and a lookup of the whole digest is one listing of this folder.
 * There is no manifest for two requests to overwrite; narrating two segments at once adds two
 * files. An edited story has no file under its new hash and is narrated again; an unchanged one
 * always finds its file and never is.
 */

export const SEGMENT_HASH_CHARS = 12;

/** "intro", "outro", or an item id. Nothing that could leave the segment folder. */
export const SEGMENT_KEY = /^[a-z0-9]{1,32}$/;

/** Everything a digest has in the store sits under this prefix: its whole MP3 and its segments. */
export const digestPrefix = (digest: string): string => `audio/${digest}`;
export const segmentPrefix = (digest: string): string => `audio/${digest}/seg/`;

export function segmentHash(text: string, voice: string, model: string): string {
  return createHash("sha256")
    .update(`${voice}\n${model}\n${text}`)
    .digest("hex")
    .slice(0, SEGMENT_HASH_CHARS);
}

export function segmentPath(digest: string, key: string, hash: string): string {
  return `${segmentPrefix(digest)}${key}.${hash}.mp3`;
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * How long a stored segment plays, worked out from its size: the audio is constant bitrate, so
 * bytes are time. It is an estimate, a few frames off at most, and the player corrects it from the
 * audio element once the file loads. When the store reports no size, the estimate comes from the
 * text length instead.
 */
export function estimateDurationMs(size: number, characters: number): number {
  if (size > 0) return durationFromMp3Bytes(size, DEFAULT_OUTPUT_FORMAT);
  return Math.max(1, Math.round(characters * MS_PER_CHARACTER));
}

/** A stored object as a segment's audio, or null when it cannot be played from. */
export function segmentAudio(
  entry: BlobEntry | null | undefined,
  characters: number,
): { url: string; duration_ms: number } | null {
  if (!entry || !isHttps(entry.url)) return null;
  return { url: entry.url, duration_ms: estimateDurationMs(entry.size, characters) };
}

/**
 * The digest's segments, each with the audio the listing holds for it. A segment's file is the one
 * at the path its current text and voice work out to, so a file made from other text or another
 * voice (an older hash) is not found, and nothing else in the folder can be mistaken for it.
 */
export function describeSegments(
  segments: readonly SpokenSegment[],
  listing: readonly BlobEntry[],
  digest: string,
  voice: string,
  model: string,
): NarrationSegment[] {
  const files = new Map(listing.map((entry) => [entry.pathname, entry]));
  return segments.map((segment) => {
    const path = segmentPath(digest, segment.key, segmentHash(segment.text, voice, model));
    return {
      key: segment.key,
      item_id: segment.itemId,
      characters: segment.text.length,
      audio: segmentAudio(files.get(path), segment.text.length),
    };
  });
}
