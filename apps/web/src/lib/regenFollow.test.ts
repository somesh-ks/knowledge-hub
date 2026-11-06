import { autoStories } from "@singularity/core/storyCount";
import { describe, expect, it } from "vitest";
import {
  desiredChip,
  desiredLength,
  desiredStories,
  NO_ANSWER,
  stepLength,
  wantedControls,
  wordLength,
  wordStories,
} from "./regenFollow";

describe("regenFollow (D371)", () => {
  // The bug it prevents: a control that stays after the comment that called for it is cleared.
  it("calls for nothing once the words and the models' answers are gone", () => {
    const answer = {
      hints: { length: true, topics: false, stories: false },
      values: { length: "longer" as const, stories: "more" as const, add: ["AI"] },
    };
    expect(wantedControls("it dragged", ["AI"], answer)).toEqual({
      length: true,
      topics: true,
      stories: true,
    });
    expect(wantedControls("", ["AI"], NO_ANSWER)).toEqual({
      length: false,
      topics: false,
      stories: false,
    });
  });

  // The bug it prevents: "shorter" from the 3 minute episode landing on a length that is not offered.
  it("steps one length along and stops at the ends", () => {
    expect(stepLength(5, "longer")).toBe(10);
    expect(stepLength(5, "shorter")).toBe(3);
    expect(stepLength(3, "shorter")).toBe(3);
    expect(stepLength(15, "longer")).toBe(15);
    expect(desiredLength(5, NO_ANSWER.values)).toBe(5);
  });

  // The bug it prevents (2026-11-06): "More stories" reached the run at the count the length set
  // and aired 12 stories again. The count is its own control now (D377), stepped from what aired
  // before any model answers, and the length stays where it was.
  it("answers 'more stories' with more stories, not a longer length", () => {
    expect(wordStories("More stories")).toBe("more");
    expect(wordLength("More stories")).toBeNull();
    expect(desiredLength(5, NO_ANSWER.values, "More stories")).toBe(5);
    // At 5 minutes the step from 12 lands on Auto's count, which the list offers only as Auto.
    const stepped = desiredStories(12, 5, NO_ANSWER.values, "More stories");
    expect(Number(stepped || autoStories(5))).toBeGreaterThan(12);
    expect(wordStories("not enough news")).toBe("more");
    expect(wordStories("fewer stories please")).toBe("fewer");
    expect(wordStories("too many stories")).toBe("fewer");
    expect(wordStories("more stories but fewer stories")).toBeNull();
    // A topic or an aside is not a count.
    expect(wordStories("more stories about AI")).toBeNull();
    expect(wordStories("more stories in Sports")).toBeNull();
    expect(wordStories("fewer stories in crypto")).toBeNull();
    expect(wordStories("more stories in it")).toBe("more");
    expect(wordStories("no more stories, please")).toBeNull();
    // No ask for a count leaves it on Auto, which sends nothing.
    expect(desiredStories(12, 5, NO_ANSWER.values, "too much hype")).toBe("");
    // More than the length holds takes the next length too, so the ask is never sent unchanged:
    // 3 minutes holds 14 at the shortest telling, so 12 aired steps to 5 minutes and 15 stories.
    expect(desiredLength(3, NO_ANSWER.values, "More stories", 12)).toBe(5);
    // At 5 minutes the step from 12 lands on Auto's count, which the list offers only as Auto.
    const more = desiredStories(12, 5, NO_ANSWER.values, "More stories");
    expect(Number(more || autoStories(5))).toBeGreaterThan(12);
    expect(wantedControls("More stories", [], NO_ANSWER, 3, 12).length).toBe(true);
    // Haiku's answer beats the words once it comes.
    expect(desiredStories(12, 5, { length: null, stories: "fewer", add: [] }, "More stories")).toBe(
      "10",
    );
    expect(wantedControls("More stories", [], NO_ANSWER).stories).toBe(true);
  });

  it("steps the length on words about time", () => {
    expect(wordLength("it was too short")).toBe("longer");
    expect(wordLength("too long and it dragged")).toBe("shorter");
    expect(wordLength("the AI story is no longer news")).toBeNull();
    expect(wordLength("Shorter intro")).toBeNull();
    expect(wordLength("make it shorter")).toBe("shorter");
    // Haiku's answer beats the words once it comes.
    expect(desiredLength(5, { length: "shorter", stories: null, add: [] }, "too short")).toBe(3);
    // Whatever moves the length shows its control.
    expect(wantedControls("it dragged", [], NO_ANSWER).length).toBe(true);
  });

  it("keeps a category the episode was made with and adds the one the comment wants", () => {
    const values = { length: null, stories: null, add: ["Business"] };
    expect(desiredChip("Business", false, values)).toBe(true);
    expect(desiredChip("AI", true, values)).toBe(true);
    expect(desiredChip("AI", false, values)).toBe(false);
  });
});
