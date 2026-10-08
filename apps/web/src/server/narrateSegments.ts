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
 * Where a narrated segment lives.
 *
 * A segment is stored at
 *
 *   audio/<digest>/seg/<key>.<hash>.mp3
 *
 * The hash covers the text, the voice and the model, so the name, and with the store's public
 * address the whole URL, can be worked out from the digest alone. That is what keeps the store
 * cheap. A lookup asks the store nothing: it answers with the address each segment would have, and
 * the page finds out by trying it. A request to narrate one segment finds out whether it exists
 * with a head. There is no listing and no manifest for two requests to overwrite; narrating two
 * segments at once adds two files. An edited story has no file under its new hash and is narrated
 * again; an unchanged one always finds its file and never is.
 */

export const SEGMENT_HASH_CHARS = 12;

/** "intro", "outro", or an item id. Nothing that could leave the segment folder. */
export const SEGMENT_KEY = /^[a-z0-9]{1,32}$/;

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

/** How long a segment should play, guessed from the length of its text alone. */
export function estimateFromText(characters: number): number {
  return Math.max(1, Math.round(characters * MS_PER_CHARACTER));
}

/**
 * How long a stored segment plays, worked out from its size: the audio is constant bitrate, so
 * bytes are time. A few frames off at most. When the store reports no size, the guess comes from
 * the text length instead.
 */
export function estimateDurationMs(size: number, characters: number): number {
  return size > 0
    ? durationFromMp3Bytes(size, DEFAULT_OUTPUT_FORMAT)
    : estimateFromText(characters);
}

/** A stored object the store has just confirmed, as a segment's audio, or null when unusable. */
export function segmentAudio(
  entry: BlobEntry | null | undefined,
  characters: number,
): { url: string; duration_ms: number; confirmed: true } | null {
  if (!entry || !isHttps(entry.url)) return null;
  return {
    url: entry.url,
    duration_ms: estimateDurationMs(entry.size, characters),
    confirmed: true,
  };
}

/**
 * The digest's segments for a lookup, without asking the store anything. Each gets the address its
 * file would have for its current text and voice, marked unconfirmed: the file may not exist yet,
 * and the page finds out by trying it. Without the store's public address (`publicBase` null) no
 * address can be worked out and every segment's audio is null.
 *
 * `voice` is one voice for every segment, or a function from a segment's key to its voice: a
 * two-host episode is read in two.
 */
export function describeSegments(
  segments: readonly SpokenSegment[],
  publicBase: string | null,
  digest: string,
  voice: string | ((key: string) => string),
  model: string,
): NarrationSegment[] {
  return segments.map((segment) => {
    const characters = segment.text.length;
    const voiceOf = typeof voice === "string" ? voice : voice(segment.key);
    const path = segmentPath(digest, segment.key, segmentHash(segment.text, voiceOf, model));
    return {
      key: segment.key,
      item_id: segment.itemId,
      characters,
      audio:
        publicBase === null
          ? null
          : {
              url: `${publicBase}/${path}`,
              duration_ms: estimateFromText(characters),
              confirmed: false,
            },
    };
  });
}
