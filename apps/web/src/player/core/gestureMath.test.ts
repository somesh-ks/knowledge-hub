import { describe, expect, it } from "vitest";
import {
  createVelocityTracker,
  decideRelease,
  estimateVelocity,
  isTap,
  OPEN_DISTANCE,
  progressFromDrag,
  type ReleaseInput,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  velocityToProgressPerSecond,
} from "./gestureMath";

const thresholds = { distance: 0.35, velocity: 0.5 };
const DISTANCE = 800;

function release(overrides: Partial<ReleaseInput>): 0 | 1 {
  return decideRelease(
    {
      travelPx: 0,
      velocityPxPerMs: 0,
      distancePx: DISTANCE,
      originOpen: false,
      cancelled: false,
      ...overrides,
    },
    thresholds,
  );
}

describe("velocity", () => {
  it("estimates velocity from the last 100 ms only", () => {
    const samples = [
      { value: 0, t: 0 },
      { value: 2, t: 400 },
      { value: 100, t: 460 },
      { value: 160, t: 480 },
    ];
    // The sample at 400 ms is the first inside the 100 ms window ending at 480 ms.
    expect(estimateVelocity(samples)).toBeCloseTo((160 - 2) / (480 - 400), 5);
    expect(estimateVelocity([])).toBe(0);
    expect(estimateVelocity([{ value: 5, t: 10 }])).toBe(0);
  });

  it("tracks velocity through a ring of recent samples", () => {
    const tracker = createVelocityTracker();
    tracker.reset({ value: 0, t: 0 });
    for (let index = 1; index <= 10; index += 1) tracker.push(index * 10, index * 10);
    expect(tracker.velocity()).toBeCloseTo(1, 5);
  });

  it("reads zero when the finger stopped before it lifted", () => {
    const tracker = createVelocityTracker();
    tracker.reset({ value: 0, t: 0 });
    for (let index = 1; index <= 5; index += 1) tracker.push(index * 30, index * 16);
    // The lift is pushed as a sample: same place, a quarter of a second later.
    tracker.push(150, 80 + 250);
    expect(tracker.velocity()).toBe(0);
  });

  it("converts pixels per millisecond to progress per second, upward positive", () => {
    expect(velocityToProgressPerSecond(-1, 800)).toBeCloseTo(1.25, 5);
    expect(velocityToProgressPerSecond(0.8, 800)).toBeCloseTo(-1, 5);
    expect(velocityToProgressPerSecond(1, 0)).toBe(0);
  });
});

describe("taps", () => {
  it("accepts a press that stays inside the slop and is short", () => {
    expect(isTap(0, 60)).toBe(true);
    expect(isTap(10, 150)).toBe(true);
    expect(isTap(TAP_SLOP_PX, 150)).toBe(true);
  });

  it("rejects travel past the slop, however quick", () => {
    expect(isTap(TAP_SLOP_PX + 1, 20)).toBe(false);
  });

  it("rejects a long press, which belongs to the browser", () => {
    expect(isTap(0, TAP_MAX_MS)).toBe(true);
    expect(isTap(0, TAP_MAX_MS + 1)).toBe(false);
  });

  it("uses a slop wide enough for a thumb", () => {
    expect(TAP_SLOP_PX).toBe(12);
  });
});

describe("where a lift sends the page", () => {
  it("dismisses on a flick down, whatever the travel", () => {
    expect(release({ originOpen: true, travelPx: 30, velocityPxPerMs: 0.8 })).toBe(0);
    expect(release({ originOpen: false, travelPx: -400, velocityPxPerMs: 0.8 })).toBe(0);
  });

  it("opens on a flick up, whatever the travel", () => {
    expect(release({ originOpen: false, travelPx: -30, velocityPxPerMs: -0.6 })).toBe(1);
    expect(release({ originOpen: true, travelPx: 500, velocityPxPerMs: -0.6 })).toBe(1);
  });

  it("dismisses after enough travel down when the finger is not coming back", () => {
    expect(release({ originOpen: true, travelPx: 0.5 * DISTANCE, velocityPxPerMs: 0.05 })).toBe(0);
    expect(release({ originOpen: true, travelPx: 0.5 * DISTANCE, velocityPxPerMs: -0.3 })).toBe(1);
    expect(release({ originOpen: true, travelPx: 0.2 * DISTANCE, velocityPxPerMs: 0.2 })).toBe(1);
  });

  it("opens after enough travel up when the finger is not coming back", () => {
    expect(release({ travelPx: -0.4 * DISTANCE })).toBe(1);
    expect(release({ travelPx: -0.4 * DISTANCE, velocityPxPerMs: 0.3 })).toBe(0);
    expect(release({ travelPx: -0.1 * DISTANCE, velocityPxPerMs: -0.1 })).toBe(0);
  });

  it("asks for less travel to open than to close", () => {
    expect(OPEN_DISTANCE).toBeLessThan(thresholds.distance);
    const travel = ((OPEN_DISTANCE + thresholds.distance) / 2) * DISTANCE;
    expect(release({ originOpen: false, travelPx: -travel })).toBe(1);
    expect(release({ originOpen: true, travelPx: travel })).toBe(1);
  });

  it("goes back where it was headed when the gesture decided nothing", () => {
    expect(release({ originOpen: true, travelPx: 40 })).toBe(1);
    expect(release({ originOpen: false, travelPx: -40 })).toBe(0);
  });

  it("reads this gesture's travel, never how far the page has got", () => {
    // A page caught a fifth of the way up and nudged 20 px down: the old rule saw 80 percent
    // "travelled" and dismissed it.
    expect(release({ originOpen: true, travelPx: 20, velocityPxPerMs: 0.05 })).toBe(1);
  });

  it("goes back where it was headed when the system ends the gesture", () => {
    expect(release({ originOpen: true, travelPx: 700, velocityPxPerMs: 2, cancelled: true })).toBe(
      1,
    );
    expect(
      release({ originOpen: false, travelPx: -700, velocityPxPerMs: -2, cancelled: true }),
    ).toBe(0);
  });

  it("decides nothing when there is no travel to measure against", () => {
    expect(release({ originOpen: true, distancePx: 0, velocityPxPerMs: 3 })).toBe(1);
  });
});

describe("following the finger", () => {
  it("moves one to one from the value the finger took hold at", () => {
    expect(progressFromDrag(1, 200, 800)).toBe(0.75);
    expect(progressFromDrag(0, -200, 800)).toBe(0.25);
    expect(progressFromDrag(0.3, 80, 800)).toBeCloseTo(0.2, 6);
  });

  it("stops at both ends", () => {
    expect(progressFromDrag(1, -100, 800)).toBe(1);
    expect(progressFromDrag(1, 900, 800)).toBe(0);
    expect(progressFromDrag(0, 50, 800)).toBe(0);
  });

  it("holds still when there is no travel to follow", () => {
    expect(progressFromDrag(0.4, 100, 0)).toBe(0.4);
  });
});
