/**
 * When each word of a narrated segment is said, as stored beside its audio and served by
 * /api/narrate-marks. Shared by the narrate function, which writes and checks it, and the player,
 * which reads it, so it imports nothing from either.
 *
 * `word` is the word's index in the segment's text split on white space; the times are
 * milliseconds from the start of the segment's own audio. A word Speechify gave no mark is absent.
 */
export interface SegmentWordMark {
  word: number;
  start_ms: number;
  end_ms: number;
}

export interface SegmentMarks {
  words: SegmentWordMark[];
}

/** More words than any turn or story has. A larger file is not one this site wrote. */
export const MAX_SEGMENT_MARKS = 20_000;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The marks in `value`, or null when it is not the shape above. */
export function parseSegmentMarks(value: unknown): SegmentMarks | null {
  if (typeof value !== "object" || value === null) return null;
  const words = (value as { words?: unknown }).words;
  if (!Array.isArray(words) || words.length > MAX_SEGMENT_MARKS) return null;
  const parsed: SegmentWordMark[] = [];
  for (const entry of words) {
    if (typeof entry !== "object" || entry === null) return null;
    const { word, start_ms, end_ms } = entry as Record<string, unknown>;
    if (!isCount(word) || !isCount(start_ms) || !isCount(end_ms) || end_ms < start_ms) return null;
    parsed.push({ word, start_ms, end_ms });
  }
  return { words: parsed };
}
