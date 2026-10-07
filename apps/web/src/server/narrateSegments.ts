import { createHash } from "node:crypto";
import type { SpokenSegment } from "@dispatch/engine/audio";
import type { NarrationSegment } from "../types/contracts";
import type { BlobEntry } from "./blobStore";

/**
 * Where a narrated segment lives, and how the store's listing is read back into segments.
 *
 * The listing is the only record of which segments exist. A segment is stored at
 *
 *   audio/<digest>/seg/<key>.<hash>.<duration in ms>.mp3
 *
 * and that name carries everything a lookup needs: which segment it is, which text and voice it was
 * made from, and how long it plays. So a lookup is one list call, and there is no manifest for two
 * requests to overwrite. Narrating different segments of one digest at the same time just adds two
 * files.
 *
 * The hash covers the text, the voice and the model. An edited story therefore has no file under its
 * new hash and is narrated again; an unchanged one always finds its file and never is.
 */

export const SEGMENT_HASH_CHARS = 12;

/** "intro", "outro", or an item id. Nothing that could leave the segment folder. */
export const SEGMENT_KEY = /^[a-z0-9]{1,32}$/;

const SEGMENT_FILE = /^([a-z0-9]{1,32})\.([0-9a-f]{12})\.([1-9]\d{0,8})\.mp3$/;

/** Everything a digest has in the store sits under this prefix: its whole MP3 and its segments. */
export const digestPrefix = (digest: string): string => `audio/${digest}`;
export const segmentPrefix = (digest: string): string => `audio/${digest}/seg/`;

export function segmentHash(text: string, voice: string, model: string): string {
  return createHash("sha256")
    .update(`${voice}\n${model}\n${text}`)
    .digest("hex")
    .slice(0, SEGMENT_HASH_CHARS);
}

export function segmentPath(digest: string, key: string, hash: string, durationMs: number): string {
  return `${segmentPrefix(digest)}${key}.${hash}.${Math.round(durationMs)}.mp3`;
}

export interface StoredSegment {
  key: string;
  hash: string;
  durationMs: number;
  url: string;
  uploadedAt: number;
}

/** Reads one listed object back into a segment, or null when it is not a segment of this digest. */
export function parseSegmentEntry(digest: string, entry: BlobEntry): StoredSegment | null {
  const prefix = segmentPrefix(digest);
  if (!entry.pathname.startsWith(prefix)) return null;
  const match = SEGMENT_FILE.exec(entry.pathname.slice(prefix.length));
  if (!match?.[1] || !match[2] || !match[3]) return null;
  let secure = false;
  try {
    secure = new URL(entry.url).protocol === "https:";
  } catch {
    secure = false;
  }
  if (!secure) return null;
  return {
    key: match[1],
    hash: match[2],
    durationMs: Number(match[3]),
    url: entry.url,
    uploadedAt: entry.uploadedAt,
  };
}

/**
 * The digest's segments, each with the audio the listing holds for it. A file made from other text
 * or another voice (an older hash) is not this segment's audio. If the same segment was narrated
 * twice, the first upload wins, so every lookup names the same file.
 */
export function describeSegments(
  segments: readonly SpokenSegment[],
  listing: readonly BlobEntry[],
  digest: string,
  voice: string,
  model: string,
): NarrationSegment[] {
  const stored = listing
    .map((entry) => parseSegmentEntry(digest, entry))
    .filter((entry): entry is StoredSegment => entry !== null)
    .sort((a, b) => a.uploadedAt - b.uploadedAt || a.url.localeCompare(b.url));

  return segments.map((segment) => {
    const hash = segmentHash(segment.text, voice, model);
    const file = stored.find((entry) => entry.key === segment.key && entry.hash === hash);
    return {
      key: segment.key,
      item_id: segment.itemId,
      characters: segment.text.length,
      audio: file ? { url: file.url, duration_ms: file.durationMs } : null,
    };
  });
}

/**
 * One blob per digest that has had anything narrated by the Play button. Its upload time is when the
 * digest took its place under the daily cap, so the cap counts digests, however many segments each
 * one has.
 */
export const SLOT_PREFIX = "state/slots/";
export const slotKey = (digest: string): string => `${SLOT_PREFIX}${digest}.json`;
