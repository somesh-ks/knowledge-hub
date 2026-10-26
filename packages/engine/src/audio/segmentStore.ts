import { createHash } from "node:crypto";
import { EpisodeId, readEpisodeScript } from "@singularity/core";
import { DEFAULT_LANGUAGE, DEFAULT_MODEL, DEFAULT_VOICE_ID, type SpeechMark } from "./speechify.js";

/**
 * Where a narrated segment lives, shared by the site's /api/narrate (which narrates a segment on
 * Play and tells the page each segment's address) and the engine's `publish` (which narrates a new
 * episode ahead of time). Both must name a segment the same way, or a stored file is never found.
 * Not part of `@singularity/engine/audio`, whose imports stay free of every `node:` module.
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

/** When each word of a segment is said; the site's lib/segmentMarks.ts reads this shape. */
export interface SegmentWordMark {
  word: number;
  start_ms: number;
  end_ms: number;
}

/** The segment key of an episode's turn. */
export const turnKey = (idx: number): string => `t${idx}`;

/**
 * A segment's name holds the hash of its text and voice, so the words behind a URL never change and
 * the file can be kept for a year (Blob sets max-age only; `immutable` is not an option it offers).
 * The briefing and episode files at a fixed key (audio/<id>.mp3, covers/<id>-<size>) are not
 * named by their content, so they keep a short cache (2026-10-26).
 */
export const SEGMENT_CACHE_SECONDS = 365 * 24 * 60 * 60;

/**
 * The second host's voice when SPEECHIFY_VOICE_ID_B is not set at all: a deeper male voice from the
 * same generation as the default first voice (geffen_32), so a discussion sounds like two people.
 * Checked against the Speechify catalogue on 2026-10-08.
 */
export const DEFAULT_SECOND_VOICE = "dominic_32";

export const SEGMENT_HASH_CHARS = 12;

/** "intro", "outro", or an item id. Nothing that could leave the segment folder. */
export const SEGMENT_KEY = /^[a-z0-9]{1,32}$/;

export const segmentPrefix = (digest: string): string => `audio/${digest}/seg/`;

export function segmentHash(text: string, voice: string, model: string): string {
  return (
    createHash("sha256")
      // The language is in the key so a segment made before it was pinned is never stitched in.
      .update(`${voice}\n${model}\n${DEFAULT_LANGUAGE}\n${text}`)
      .digest("hex")
      .slice(0, SEGMENT_HASH_CHARS)
  );
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

/** The voices that read an episode's hosts, from the environment the site's narrate route has. */
export interface EpisodeVoiceEnv {
  SPEECHIFY_VOICE_ID?: string | undefined;
  SPEECHIFY_VOICE_ID_B?: string | undefined;
}

export interface PlannedSegment {
  key: string;
  text: string;
  voice: string;
  path: string;
}

export interface EpisodePlan {
  id: string;
  segments: PlannedSegment[];
}

const blank = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * Every turn of an episode file with the voice that reads it and where its audio lives, worked out
 * as the site's lookup does (hostVoices in apps/web/src/server/narrate.ts): the request's voices,
 * else the environment's, else the defaults. The workflow cannot tell an unset variable from an
 * empty one, so an empty SPEECHIFY_VOICE_ID_B reads as unset (the second default voice).
 */
export function planEpisodeNarration(fileText: string, env: EpisodeVoiceEnv): EpisodePlan {
  const script = readEpisodeScript(fileText);
  const id = EpisodeId.parse(script.id);
  if (script.turns.length === 0) throw new Error(`Episode ${id} has no turns`);
  const a = script.voice_id ?? blank(env.SPEECHIFY_VOICE_ID) ?? DEFAULT_VOICE_ID;
  const b = script.voice_id_b ?? blank(env.SPEECHIFY_VOICE_ID_B) ?? DEFAULT_SECOND_VOICE;
  return {
    id,
    segments: script.turns.map((turn) => {
      const key = turnKey(turn.idx);
      const voice = turn.speaker === "b" ? b : a;
      return {
        key,
        text: turn.text,
        voice,
        path: segmentPath(id, key, segmentHash(turn.text, voice, DEFAULT_MODEL)),
      };
    }),
  };
}
