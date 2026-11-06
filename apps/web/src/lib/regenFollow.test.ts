import { describe, expect, it } from "vitest";
import {
  desiredChip,
  desiredLength,
  NO_ANSWER,
  stepLength,
  wantedControls,
  wordLength,
} from "./regenFollow";

describe("regenFollow (D371)", () => {
  // The bug it prevents: a control that stays after the comment that called for it is cleared.
  it("calls for nothing once the words and the models' answers are gone", () => {
    const answer = {
      hints: { length: true, topics: false },
      values: { length: "longer" as const, add: ["AI"] },
    };
    expect(wantedControls("it dragged", ["AI"], answer)).toEqual({ length: true, topics: true });
    expect(wantedControls("", ["AI"], NO_ANSWER)).toEqual({ length: false, topics: false });
  });

  // The bug it prevents: "shorter" from the 3 minute episode landing on a length that is not offered.
  it("steps one length along and stops at the ends", () => {
    expect(stepLength(5, "longer")).toBe(10);
    expect(stepLength(5, "shorter")).toBe(3);
    expect(stepLength(3, "shorter")).toBe(3);
    expect(stepLength(15, "longer")).toBe(15);
    expect(desiredLength(5, NO_ANSWER.values)).toBe(5);
  });

  // The bug it prevents (2026-11-06): "More stories" waited on a model, reached the run at the
  // length the podcast was made at, and aired 12 stories again.
  it("answers 'more stories' with a longer length before any model has", () => {
    expect(wordLength("More stories")).toBe("longer");
    expect(wordLength("it was too short, not enough news")).toBe("longer");
    expect(wordLength("fewer stories please")).toBe("shorter");
    expect(wordLength("too long and it dragged")).toBe("shorter");
    expect(wordLength("more stories but shorter")).toBeNull();
    expect(wordLength("too much hype")).toBeNull();
    // A topic or an aside is not a length.
    expect(wordLength("more stories about AI")).toBeNull();
    expect(wordLength("the AI story is no longer news")).toBeNull();
    expect(desiredLength(5, NO_ANSWER.values, "More stories")).toBe(10);
    // Haiku's answer beats the words once it comes.
    expect(desiredLength(5, { length: "shorter", add: [] }, "More stories")).toBe(3);
    // Whatever moves the length shows its control.
    expect(wantedControls("it dragged", [], NO_ANSWER).length).toBe(true);
  });

  it("keeps a category the episode was made with and adds the one the comment wants", () => {
    const values = { length: null, add: ["Business"] };
    expect(desiredChip("Business", false, values)).toBe(true);
    expect(desiredChip("AI", true, values)).toBe(true);
    expect(desiredChip("AI", false, values)).toBe(false);
  });
});
