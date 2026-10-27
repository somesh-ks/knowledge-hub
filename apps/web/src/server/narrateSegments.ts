import {
  DEFAULT_OUTPUT_FORMAT,
  durationFromMp3Bytes,
  type SpokenSegment,
} from "@singularity/engine/audio";
import { episodeOpusAddress, segmentHash, segmentPath } from "@singularity/engine/segments";
import type { NarrationSegment } from "../types/contracts";
import type { BlobEntry } from "./blobStore";
import { MS_PER_CHARACTER } from "./config";

/**
 * Where a narrated segment lives: see @singularity/engine/segments, which the engine's `publish` shares
 * so that a turn it narrates ahead of time is found here under the same name.
 */
export {
  deriveSegmentMarks,
  SEGMENT_HASH_CHARS,
  SEGMENT_KEY,
  segmentHash,
  segmentMarksPath,
  segmentPath,
  segmentPrefix,
} from "@singularity/engine/segments";

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
 * Where a finished episode's single Opus file and its manifest of turn offsets would be (the
 * engine's `publish` makes them once every turn is stored). Worked out like the turns' addresses,
 * without asking the store; the page reads the manifest and takes the file only if it is there.
 * Null without the store's public address.
 */
export function describeEpisodeOpus(
  segments: readonly SpokenSegment[],
  publicBase: string | null,
  episode: string,
  voice: (key: string) => string,
  model: string,
): { url: string; manifest_url: string } | null {
  if (publicBase === null || segments.length === 0) return null;
  const address = episodeOpusAddress(
    episode,
    segments.map((segment) =>
      segmentPath(episode, segment.key, segmentHash(segment.text, voice(segment.key), model)),
    ),
  );
  return {
    url: `${publicBase}/${address.path}`,
    manifest_url: `${publicBase}/${address.manifestPath}`,
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
