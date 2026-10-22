import { DEFAULT_SCHEDULE, VOICE_LIMITS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS } from "../src/audio/spokenText.js";
import { DEFAULT_CAP } from "../src/prefilter/prefilter.js";
import {
  lengthMinutesFor,
  poolCapFor,
  sparesOverLength,
  storiesForMinutes,
  withSpares,
} from "../src/run/scheduleSize.js";
import { narrationLength } from "../src/run/validateStage.js";
import { makeDigest } from "./audio-fixtures.js";

describe("sizing a briefing by its length", () => {
  // The 2026-10-18 weekly, set to 15 minutes, aired 14 stories and 5 minutes: the judge saw the
  // five-minute daily's 60 candidates, selection filled 27 of its slots, and grounding and
  // validation dropped 13 of those 27.
  it("gives a 15-minute weekly the candidates and spares to fill its length after the usual losses", () => {
    const schedule = {
      ...DEFAULT_SCHEDULE,
      weekly: { ...DEFAULT_SCHEDULE.weekly, length_minutes: 15 as const },
    };
    const minutes = lengthMinutesFor(schedule, "weekly", "scheduled");
    expect(minutes).toBe(15);
    const wanted = storiesForMinutes(
      minutes ?? 0,
      VOICE_LIMITS.items.floor,
      VOICE_LIMITS.items.hardMax,
    );
    const written = withSpares(wanted);
    // About 45% of what selection chooses never airs (scheduleSize.ts, SPARE_SHARE).
    expect(Math.floor(written * 0.55)).toBeGreaterThanOrEqual(wanted);
    expect(poolCapFor(written, DEFAULT_CAP)).toBeGreaterThan(2 * DEFAULT_CAP);
  });

  // The 2026-10-17 daily aired 10 of its 11 stories, 3.7 of its 5 minutes: the trim's estimate of
  // the host's frame (60 a story, 600 an episode) ran 905 characters over the real narration.
  it("keeps every story the length still has room for, measured by the real narration", () => {
    const stories = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      category: `topic-${i}`,
      score: 1 - i / 100,
      chars: 370,
    }));
    // About 30 characters of frame a story, as 2026-10-17's narration had.
    const narration = (ids: ReadonlySet<string>) => ids.size * 400 + 100;
    expect(sparesOverLength(stories, 4840, 3, narration)).toEqual([]);
    // Past the length, the real measure still trims the lowest-scored story.
    expect(sparesOverLength(stories, 3600, 3, narration)).toEqual(["s10", "s9"]);
  });

  // A 15-minute weekly's untrimmed spares run past the 19,000 characters one narration request
  // takes, and buildSpokenText refuses them: measuring them must not fail the run.
  it("measures a narration past the one-request limit instead of failing", () => {
    const base = makeDigest({}, 40);
    const digest = {
      ...base,
      items: base.items.map((item) => ({ ...item, spoken: "A long telling. ".repeat(40) })),
    };
    const all = new Set(digest.items.map((item) => item.id));
    expect(narrationLength(digest, all)).toBeGreaterThan(MAX_SPOKEN_CHARS);
  });
});
