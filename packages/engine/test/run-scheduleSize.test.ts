import { DEFAULT_SCHEDULE, VOICE_LIMITS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_CAP } from "../src/prefilter/prefilter.js";
import {
  lengthMinutesFor,
  poolCapFor,
  storiesForMinutes,
  withSpares,
} from "../src/run/scheduleSize.js";

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
});
