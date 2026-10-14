import { describe, expect, it } from "vitest";
import type { PlayerTurn } from "../../types/contracts";
import {
  estimateWordStarts,
  markedWordStarts,
  splitWords,
  spokenPosition,
  spokenWordIndex,
  turnEndMs,
  wordIndexAt,
} from "./scriptMath";

const turn = (start_ms: number | null, end_ms: number | null): PlayerTurn => ({
  key: `t${start_ms}`,
  speaker: "a",
  text: "x",
  start_ms,
  end_ms,
});

describe("the transcript's words", () => {
  it("splits on any white space and drops empty pieces", () => {
    expect(splitWords("  Hello,\n there  world ")).toEqual(["Hello,", "there", "world"]);
  });

  it("spreads a turn's span over its words by length", () => {
    // Weights 2, 4, 2 of 8: the words start at 0, 250 and 750 of 1000.
    expect(estimateWordStarts(["a", "bcd", "e"], 1000, 2000)).toEqual([1000, 1250, 1750]);
  });

  it("has no estimate without a span", () => {
    expect(estimateWordStarts(["a"], null, 2000)).toBeNull();
    expect(estimateWordStarts(["a"], 1000, null)).toBeNull();
    expect(estimateWordStarts(["a"], 1000, 1000)).toBeNull();
    expect(estimateWordStarts([], 1000, 2000)).toBeNull();
  });

  it("finds the word being said", () => {
    const starts = [1000, 1250, 1750];
    expect(wordIndexAt(starts, 999)).toBe(-1);
    expect(wordIndexAt(starts, 1000)).toBe(0);
    expect(wordIndexAt(starts, 1500)).toBe(1);
    expect(wordIndexAt(starts, 5000)).toBe(2);
  });

  it("lights a word a hair before its mark, so a drawn frame is not late for the voice", () => {
    const starts = [1000, 1250, 1750];
    // The clock reads 1.2 s: the second word starts 50 ms on, inside the lead; the third does not.
    expect(spokenWordIndex(starts, 1.2)).toBe(1);
    expect(spokenWordIndex(starts, 1.5)).toBe(1);
    expect(spokenWordIndex(starts, 0.8)).toBe(-1);
  });

  it("ends a turn at its own end, else at the next timed turn", () => {
    const turns = [turn(0, 900), turn(1000, null), turn(null, null), turn(3000, null)];
    expect(turnEndMs(turns, 0)).toBe(900);
    expect(turnEndMs(turns, 1)).toBe(3000);
    expect(turnEndMs(turns, 3)).toBeNull();
  });
});

describe("the transcript's word marks", () => {
  const mark = (word: number, start_ms: number) => ({ word, start_ms, end_ms: start_ms + 100 });

  it("places marked words at the turn's start plus the mark", () => {
    const estimate = [1000, 1250, 1750];
    expect(markedWordStarts(3, [mark(0, 0), mark(1, 400), mark(2, 900)], 1000, estimate)).toEqual([
      1000, 1400, 1900,
    ]);
  });

  it("keeps the estimate for a word without a mark, held between its marked neighbours", () => {
    // Word 1 is estimated at 1250, between 1000 and 1200: held at the later mark.
    expect(markedWordStarts(3, [mark(0, 0), mark(2, 200)], 1000, [1000, 1250, 1750])).toEqual([
      1000, 1200, 1200,
    ]);
    // Word 1 estimated inside the gap keeps its estimate.
    expect(markedWordStarts(3, [mark(0, 0), mark(2, 800)], 1000, [1000, 1250, 1750])).toEqual([
      1000, 1250, 1800,
    ]);
    // Without an estimate, a gap takes the mark before it.
    expect(markedWordStarts(3, [mark(0, 0), mark(2, 800)], 1000, null)).toEqual([1000, 1000, 1800]);
  });

  it("never runs backwards, so the word being said can be searched for", () => {
    const starts = markedWordStarts(4, [mark(0, 500), mark(1, 100), mark(3, 50)], 0, [0, 1, 2, 3]);
    expect(starts).toEqual([500, 500, 500, 500]);
    expect(wordIndexAt(starts ?? [], 500)).toBe(3);
  });

  it("ignores marks past the turn's words and repeats of a word", () => {
    expect(markedWordStarts(2, [mark(0, 0), mark(0, 90), mark(5, 10)], 100, [100, 200])).toEqual([
      100, 200,
    ]);
  });

  it("is the estimate when there are no marks or no start", () => {
    expect(markedWordStarts(2, undefined, 100, [100, 200])).toEqual([100, 200]);
    expect(markedWordStarts(2, [], 100, null)).toBeNull();
    expect(markedWordStarts(2, [mark(0, 0)], null, null)).toBeNull();
    expect(markedWordStarts(2, [mark(7, 0)], 100, [100, 200])).toEqual([100, 200]);
  });
});

describe("the host's words the transcript does not show", () => {
  const story = (start_ms: number, end_ms: number, text: string, lead_words = 0): PlayerTurn => ({
    key: `s${start_ms}`,
    speaker: "a",
    text,
    title: "Headline",
    start_ms,
    end_ms,
    lead_words,
  });
  // The second segment is "Now, design. Four five.": three words nobody sees, then the story.
  const turns = [story(0, 10_000, "One two three."), story(10_000, 20_000, "Four five.", 3)];
  const mark = (word: number, start_ms: number) => ({ word, start_ms, end_ms: start_ms + 100 });
  const marks = [mark(0, 0), mark(1, 400), mark(2, 900), mark(3, 2500), mark(4, 3000)];
  const first = markedWordStarts(3, undefined, 0, [0, 3000, 6000]);
  const estimated = estimateWordStarts(["Four", "five."], 10_000, 20_000, 3);

  it("keeps the story before in place and lights nothing while a bridge is spoken", () => {
    const real = markedWordStarts(2, marks, 10_000, estimated, 3);
    expect(real).toEqual([12_500, 13_000]);
    expect(spokenPosition(turns, [first, real], 11)).toEqual({ turn: 0, word: -1 });
    expect(spokenPosition(turns, [first, real], 12.5)).toEqual({ turn: 1, word: 0 });
    // After the last story, the sign-off is not on the page either.
    expect(spokenPosition(turns, [first, real], 20.5)).toEqual({ turn: 1, word: -1 });
  });

  it("does the same on the estimate, before any marks arrive", () => {
    // Lead-in 15 of 26 weight: the story begins 15/26 into the span, about 15.8 s.
    expect(spokenPosition(turns, [first, estimated], 11)).toEqual({ turn: 0, word: -1 });
    expect(spokenPosition(turns, [first, estimated], 16)).toEqual({ turn: 1, word: 0 });
  });
});
