import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS } from "../src/audio/spokenText.js";
import {
  charsForMinutes,
  overNarrationLimit,
  STORY_CHARS,
  sparesOverLength,
  storiesForMinutes,
} from "../src/run/scheduleSize.js";

describe("storiesForMinutes", () => {
  // Before: 12 stories were taken to make 10 minutes, so a 5-minute daily got 6 main stories and
  // ran about 3.5 minutes. A story with its share of the frame is about 22 seconds.
  it("takes the stories that fill the length", () => {
    for (const minutes of [5, 15]) {
      const told = storiesForMinutes(minutes, 3, 48) * STORY_CHARS;
      expect(Math.abs(told - charsForMinutes(minutes))).toBeLessThanOrEqual(STORY_CHARS / 2);
    }
  });

  // The 2026-10-24 replacement aired 3.5 of its 5 minutes: briefings were sized at the podcast's
  // 968 characters a minute, 9% slower than the voice they are narrated in.
  it("sizes at the pace the briefings' narrations ran", () => {
    // text_chars and duration_ms of the 10-18 weekly's and the 10-20, 10-22 and 10-24 dailies'
    // .audio.json.
    const narrations = [
      [5426, 306_100],
      [4202, 238_416],
      [3874, 217_009],
      [3747, 209_489],
    ] as const;
    for (const [chars, ms] of narrations) {
      expect(Math.abs(charsForMinutes(ms / 60_000) - chars) / chars).toBeLessThan(0.02);
    }
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
