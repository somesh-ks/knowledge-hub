import { describe, expect, it } from "vitest";
import { queuePercent } from "./queuePercent";

const at = (stage: number, elapsedInStageMs: number, over = {}) =>
  queuePercent({ stage, stages: 6, elapsedInStageMs, ...over });

describe("the percent inside the ring", () => {
  // The ring is read at a glance, so a run that goes from 12 to 9 or reaches 100 while still
  // working reads as broken. Whatever the stage, the clock or the estimates, it stays inside 1..99.
  it("stays between 1 and 99 for a run that is going, whatever the clock says", () => {
    for (let stage = 0; stage < 6; stage += 1) {
      for (const elapsed of [-5_000, 0, 30_000, 10 * 60_000, 10 * 3_600_000]) {
        const percent = at(stage, elapsed);
        expect(percent).toBeGreaterThanOrEqual(1);
        expect(percent).toBeLessThanOrEqual(99);
      }
    }
    expect(at(0, 0, { queued: true })).toBe(0);
  });

  it("never goes down as a run moves on, in a stage and from one stage to the next", () => {
    let last = 0;
    for (let stage = 0; stage < 6; stage += 1) {
      for (let seconds = 0; seconds <= 180; seconds += 5) {
        const percent = at(stage, seconds * 1000);
        expect(percent).toBeGreaterThanOrEqual(last);
        last = percent;
      }
    }
  });

  // The stages are not equal: the script takes minutes where the cover takes seconds, so a count of
  // stages would show the cover as a sixth of the run.
  it("weighs a stage by how long it takes, with the engine's own timings where it has them", () => {
    const evenSplit = 100 / 6;
    expect(at(2, 0)).toBeGreaterThan(evenSplit);
    expect(at(2, 0)).toBeLessThan(2 * evenSplit + 20);
    // Timed runs say the script is by far the longest stage, so the third stage starts later.
    const timed = [5_000, 200_000, 5_000, 5_000, 5_000, 5_000];
    expect(at(2, 0, { estimates: timed })).toBeGreaterThan(at(2, 0));
    // A stage with no timing keeps its prior, and junk in the list is not a timing.
    expect(at(1, 0, { estimates: [null, "x", -3, 0, Number.NaN] })).toBe(at(1, 0));
  });

  it("copes with a stage past the end, a shape nobody measured and a briefing's last stage", () => {
    expect(at(99, 0)).toBeLessThanOrEqual(99);
    expect(queuePercent({ stage: 1, stages: 4, elapsedInStageMs: 0 })).toBe(25);
    expect(queuePercent({ stage: 6, stages: 7, elapsedInStageMs: 0 })).toBe(99);
    expect(queuePercent({ stage: 0, stages: 0, elapsedInStageMs: 0 })).toBe(0);
  });
});
