import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS } from "../src/audio/spokenText.js";
import {
  charsForMinutes,
  overNarrationLimit,
  sparesOverLength,
  storiesForMinutes,
} from "../src/run/scheduleSize.js";

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

describe("sparesOverLength", () => {
  // Cutting spares by score alone would drop a topic's only story, and the topic the owner chose
  // would miss the briefing that selection had given it.
  it("keeps every topic's best story while it leaves the spares unaired", () => {
    const stories = [
      { id: "ai-1", category: "ai", score: 0.9, chars: 400 },
      { id: "ai-2", category: "ai", score: 0.8, chars: 400 },
      { id: "ai-3", category: "ai", score: 0.7, chars: 400 },
      { id: "css-1", category: "css", score: 0.5, chars: 400 },
    ];
    expect(sparesOverLength(stories, 1_500).sort()).toEqual(["ai-2", "ai-3"]);
  });

  // A five-minute replay ran 5.7 minutes when stories were counted at the 364-character average,
  // because the writer told each one longer; a count can also leave the briefing short.
  it("airs what the written stories measure, never ending short of the length", () => {
    const stories = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      category: `t${i}`,
      score: 1 - i / 100,
      chars: 500,
    }));
    const length = charsForMinutes(3);
    const kept = stories.filter((s) => !sparesOverLength(stories, length).includes(s.id));
    const airtime = kept.reduce((sum, s) => sum + s.chars + 60, 600);
    expect(airtime).toBeGreaterThanOrEqual(length);
    expect(airtime - 560).toBeLessThan(length);
  });
});
