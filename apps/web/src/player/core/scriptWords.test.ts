import { describe, expect, it } from "vitest";
import type { PlayerTurn } from "../../types/contracts";
import { estimateWordStarts, splitWords, turnEndMs, wordIndexAt } from "./scriptMath";

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

  it("ends a turn at its own end, else at the next timed turn", () => {
    const turns = [turn(0, 900), turn(1000, null), turn(null, null), turn(3000, null)];
    expect(turnEndMs(turns, 0)).toBe(900);
    expect(turnEndMs(turns, 1)).toBe(3000);
    expect(turnEndMs(turns, 3)).toBeNull();
  });
});
