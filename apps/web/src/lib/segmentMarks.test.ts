import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_MARKS, parseSegmentMarks } from "./segmentMarks";

describe("parseSegmentMarks", () => {
  it("reads the stored shape", () => {
    const value = { words: [{ word: 0, start_ms: 0, end_ms: 250 }] };
    expect(parseSegmentMarks(value)).toEqual(value);
    expect(parseSegmentMarks({ words: [] })).toEqual({ words: [] });
  });

  it("drops fields it does not know", () => {
    expect(parseSegmentMarks({ words: [{ word: 1, start_ms: 2, end_ms: 3, x: 4 }], y: 5 })).toEqual(
      {
        words: [{ word: 1, start_ms: 2, end_ms: 3 }],
      },
    );
  });

  it("refuses anything else", () => {
    for (const value of [
      null,
      "words",
      [],
      {},
      { words: "x" },
      { words: [null] },
      { words: [{ word: -1, start_ms: 0, end_ms: 1 }] },
      { words: [{ word: 0.5, start_ms: 0, end_ms: 1 }] },
      { words: [{ word: 0, start_ms: "0", end_ms: 1 }] },
      { words: [{ word: 0, start_ms: 2, end_ms: 1 }] },
      {
        words: Array.from({ length: MAX_SEGMENT_MARKS + 1 }, () => ({
          word: 0,
          start_ms: 0,
          end_ms: 0,
        })),
      },
    ]) {
      expect(parseSegmentMarks(value)).toBeNull();
    }
  });
});
