import { createHash } from "node:crypto";
import {
  DEFAULT_OUTPUT_FORMAT,
  durationFromMp3Bytes,
  type SpeechMark,
  type SpokenSegment,
} from "@dispatch/engine/audio";
import type { SegmentWordMark } from "../lib/segmentMarks";
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

/**
 * Where a segment's word marks live: beside its audio, under the same hash, so their address too
 * follows from the digest alone and reading them needs no listing.
 */
export function segmentMarksPath(audioPath: string): string {
  return audioPath.replace(/\.mp3$/, ".marks.json");
}

/** Index of the word whose span holds `offset`, or of the next word when it falls between two. */
function wordAt(words: readonly { start: number; end: number }[], offset: number): number {
  let low = 0;
  let high = words.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((words[middle]?.start ?? Number.POSITIVE_INFINITY) <= offset) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (found < 0) return words.length > 0 ? 0 : -1;
  const word = words[found];
  if (word && offset >= word.end) return found + 1 < words.length ? found + 1 : -1;
  return found;
}

/**
 * Speechify's word marks for a segment, as the words of its text split on white space. A mark's
 * offsets index the text it was given; one whose slice does not match its value is re-anchored by
 * searching after the previous one, as the engine's timeline does, and dropped if absent. A word
 * with several marks starts at the first and ends at the last. Starts never run backwards.
 */
export function deriveSegmentMarks(text: string, marks: readonly SpeechMark[]): SegmentWordMark[] {
  const words = [...text.matchAll(/\S+/g)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const byWord = new Map<number, SegmentWordMark>();
  let cursor = 0;
  for (const mark of marks) {
    if (mark.type !== undefined && mark.type !== "word") continue;
    if (mark.value.length === 0) continue;
    let start = mark.start;
    if (text.slice(mark.start, mark.end) !== mark.value) {
      const found = text.indexOf(mark.value, cursor);
      if (found < 0) continue;
      start = found;
    }
    cursor = Math.max(cursor, start + mark.value.length);
    const word = wordAt(words, start);
    if (word < 0) continue;
    const startMs = Math.round(mark.start_time);
    const endMs = Math.max(startMs, Math.round(mark.end_time));
    const known = byWord.get(word);
    if (!known) byWord.set(word, { word, start_ms: startMs, end_ms: endMs });
    else {
      known.start_ms = Math.min(known.start_ms, startMs);
      known.end_ms = Math.max(known.end_ms, endMs);
    }
  }
  const sorted = [...byWord.values()].sort((a, b) => a.word - b.word);
  let latest = 0;
  for (const mark of sorted) {
    mark.start_ms = Math.max(mark.start_ms, latest);
    mark.end_ms = Math.max(mark.end_ms, mark.start_ms);
    latest = mark.start_ms;
  }
  return sorted;
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
