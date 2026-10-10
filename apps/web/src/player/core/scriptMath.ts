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

/**
 * When each word starts, in ms, estimated by spreading the turn's span over its words in
 * proportion to their length (one extra character for the pause after each). Speechify's word
 * marks are not sent to the browser yet; this keeps the highlight close, and it snaps back at
 * every turn, whose start is exact. Null when the turn has no span.
 */
export function estimateWordStarts(
  words: readonly string[],
  startMs: number | null,
  endMs: number | null,
): number[] | null {
  if (startMs === null || endMs === null || endMs <= startMs || words.length === 0) return null;
  const weights = words.map((word) => word.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const starts: number[] = [];
  let before = 0;
  for (const weight of weights) {
    starts.push(startMs + ((endMs - startMs) * before) / total);
    before += weight;
  }
  return starts;
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
