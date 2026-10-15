import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS } from "../src/audio/spokenText.js";
import { overNarrationLimit, storiesForMinutes } from "../src/run/scheduleSize.js";

describe("storiesForMinutes", () => {
  // Before: 12 stories were taken to make 10 minutes, so a 5-minute daily got 6 main stories and
  // ran about 3.5 minutes. A story with its share of the frame is about 22 seconds.
  it("fills the length at the narration's measured pace", () => {
    expect(storiesForMinutes(5, 3, 48)).toBe(13);
    expect(storiesForMinutes(15, 3, 48)).toBe(40);
  });

  it("stays between the floor and the hard cap", () => {
    expect(storiesForMinutes(0.5, 3, 48)).toBe(3);
    expect(storiesForMinutes(60, 3, 48)).toBe(48);
  });
});

describe("overNarrationLimit", () => {
  // 40 tellings near the 700-character ceiling run past the 19,000 characters one narration
  // request takes, and the whole weekly would have lost its audio.
  it("drops the lowest-scored stories until the episode fits one narration request", () => {
    const stories = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      score: 1 - i / 100,
      chars: 650,
    }));
    const over = overNarrationLimit(stories, MAX_SPOKEN_CHARS);
    expect(over.length).toBeGreaterThan(0);
    expect(over).toEqual(stories.slice(40 - over.length).map((s) => s.id));
    expect(overNarrationLimit(stories.slice(0, 13), MAX_SPOKEN_CHARS)).toEqual([]);
  });
});
