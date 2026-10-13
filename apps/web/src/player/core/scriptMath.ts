import type { SegmentWordMark } from "../../lib/segmentMarks";
import type { PlayerTurn } from "../../types/contracts";

/**
 * The turn being spoken at `seconds`, or -1 before the first or when the turns have no times yet.
 * Turns are in playing order, so a turn without a span is skipped and the last one that has begun
 * stays current until the next begins.
 */
export function currentTurnIndex(turns: readonly PlayerTurn[], seconds: number): number {
  const ms = seconds * 1000;
  let found = -1;
  for (let index = 0; index < turns.length; index += 1) {
    const start = turns[index]?.start_ms;
    if (start === null || start === undefined) continue;
    if (start <= ms) found = index;
    else break;
  }
  return found;
}

/** How long a manual scroll keeps the script from following the voice. */
export const FOLLOW_PAUSE_MS = 4000;

/** A turn's words in reading order, split on white space. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/** An unseen lead-in word counts as this many characters, bridges being short words. */
const LEAD_WORD_WEIGHT = 5;

/**
 * When each word starts, in ms, estimated by spreading the turn's span over its words in
 * proportion to their length (one extra character for the pause after each). It stands in until
 * the turn's word marks arrive, and for any word they leave out; it snaps back at every turn,
 * whose start is exact. Null when the turn has no span.
 */
export function estimateWordStarts(
  words: readonly string[],
  startMs: number | null,
  endMs: number | null,
  leadWords = 0,
): number[] | null {
  if (startMs === null || endMs === null || endMs <= startMs || words.length === 0) return null;
  const weights = words.map((word) => word.length + 1);
  // The unseen lead-in takes its share of the span first, at the length of a short word.
  const lead = leadWords * LEAD_WORD_WEIGHT;
  const total = lead + weights.reduce((sum, weight) => sum + weight, 0);
  const starts: number[] = [];
  let before = lead;
  for (const weight of weights) {
    starts.push(startMs + ((endMs - startMs) * before) / total);
    before += weight;
  }
  return starts;
}

/**
 * When each of a turn's `count` words starts, in track ms: Speechify's mark where there is one
 * (`word` indexes the turn's text split on white space, its times count from the turn's start),
 * the estimate where there is not. A word without a mark is kept between its marked neighbours, so
 * the starts never run backwards and `wordIndexAt` can search them. The estimate, unchanged, when
 * no mark fits the turn or the turn has no start.
 */
export function markedWordStarts(
  count: number,
  marks: readonly SegmentWordMark[] | undefined,
  startMs: number | null,
  estimate: readonly number[] | null,
  lead = 0,
): number[] | null {
  const real: Array<number | undefined> = new Array(count).fill(undefined);
  // `lead` words open a briefing's segment (a section bridge, a link) that the page does not show,
  // so the mark of the story's word n is the mark of the segment's word n + lead.
  let leadEnd = 0;
  let found = false;
  for (const mark of marks ?? []) {
    const word = mark.word - lead;
    if (startMs === null) continue;
    if (word < 0) {
      leadEnd = Math.max(leadEnd, mark.end_ms);
      continue;
    }
    if (word >= count || real[word] !== undefined) continue;
    real[word] = startMs + mark.start_ms;
    found = true;
  }
  if (!found || startMs === null) return estimate ? [...estimate] : null;
  // Marks in order: one that steps back is held at the one before.
  let latest = startMs;
  for (let index = 0; index < count; index += 1) {
    const start = real[index];
    if (start === undefined) continue;
    latest = Math.max(latest, start);
    real[index] = latest;
  }
  const nextMark: number[] = new Array(count);
  let next = Number.POSITIVE_INFINITY;
  for (let index = count - 1; index >= 0; index -= 1) {
    next = real[index] ?? next;
    nextMark[index] = next;
  }
  let previous = startMs + leadEnd;
  return real.map((start, index) => {
    if (start !== undefined) {
      previous = start;
      return start;
    }
    const guess = estimate?.[index] ?? previous;
    return Math.min(Math.max(guess, previous), nextMark[index] ?? next);
  });
}

/** The word being said at `ms`: the last one that has started, or -1 before the first. */
export function wordIndexAt(starts: readonly number[], ms: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? Number.POSITIVE_INFINITY) <= ms) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/**
 * How far ahead of the element's clock the word light reads. The clock is what the decoder has
 * handed on, a little before the speaker plays it, and a fill drawn on a frame after the word has
 * begun reads as late; a word lit slightly early reads as on time.
 */
export const WORD_LEAD_MS = 90;

/** The word to light at the playhead `seconds`: `wordIndexAt` a short lead ahead. */
export function spokenWordIndex(starts: readonly number[], seconds: number): number {
  return wordIndexAt(starts, seconds * 1000 + WORD_LEAD_MS);
}

/**
 * What the transcript marks at the playhead: the turn being read and the word being said, -1 for
 * none. A turn begins at its first word (`wordStarts`, which come after any unseen lead-in), not
 * at its segment's start, so the story before it stays current while the host speaks a bridge.
 * Once a turn's span is over and the next has not begun, nothing is said that the page shows, so no
 * word is lit.
 */
export function spokenPosition(
  turns: readonly PlayerTurn[],
  wordStarts: ReadonlyArray<readonly number[] | null | undefined>,
  seconds: number,
): { turn: number; word: number } {
  const ms = seconds * 1000;
  let turn = -1;
  for (let index = 0; index < turns.length; index += 1) {
    const start = wordStarts[index]?.[0] ?? turns[index]?.start_ms;
    if (start === null || start === undefined) continue;
    if (start <= ms) turn = index;
    else break;
  }
  const starts = turn >= 0 ? wordStarts[turn] : null;
  if (!starts) return { turn, word: -1 };
  const end = turnEndMs(turns, turn);
  if (end !== null && ms >= end) return { turn, word: -1 };
  return { turn, word: spokenWordIndex(starts, seconds) };
}

/** Where a turn ends: its own end, else where the next timed turn begins. */
export function turnEndMs(turns: readonly PlayerTurn[], index: number): number | null {
  const own = turns[index]?.end_ms;
  if (own !== null && own !== undefined) return own;
  for (let next = index + 1; next < turns.length; next += 1) {
    const start = turns[next]?.start_ms;
    if (start !== null && start !== undefined) return start;
  }
  return null;
}
