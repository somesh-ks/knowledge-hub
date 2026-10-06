import { describe, expect, it } from "vitest";
import { cardScale, computeMorph, coverFrame, coverRadius, panelOffset } from "./coverMorph";
import {
  isAtRest,
  runSpring,
  runTween,
  SPRING_DURATION_SECONDS,
  type SpringState,
  springStep,
} from "./spring";

function simulate(
  spec: { duration: number; bounce: number },
  from: SpringState,
  target: number,
  seconds: number,
): SpringState[] {
  const frames: SpringState[] = [];
  let state = from;
  for (let step = 0; step < seconds * 60; step += 1) {
    state = springStep(state, target, spec, 1 / 60);
    frames.push(state);
  }
  return frames;
}

describe("spring", () => {
  const settle = { duration: SPRING_DURATION_SECONDS.settle, bounce: 0 };
  const release = { duration: SPRING_DURATION_SECONDS.release, bounce: 0.15 };

  it("settles critically damped without overshoot, in under a second", () => {
    const frames = simulate(settle, { value: 0, velocity: 0 }, 1, 1);
    expect(Math.max(...frames.map((frame) => frame.value))).toBeLessThanOrEqual(1.0001);
    const last = frames.at(-1);
    expect(last && isAtRest(last, 1)).toBe(true);
  });

  it("overshoots a little with the release spring's bounce, then settles", () => {
    const frames = simulate(release, { value: 0, velocity: 0 }, 1, 1.4);
    const peak = Math.max(...frames.map((frame) => frame.value));
    expect(peak).toBeGreaterThan(1.001);
    expect(peak).toBeLessThan(1.05);
    const last = frames.at(-1);
    expect(last && isAtRest(last, 1)).toBe(true);
  });

  it("starts at the release velocity, so a flick keeps its momentum", () => {
    const slow = springStep({ value: 0.5, velocity: 0 }, 1, settle, 1 / 60);
    const fast = springStep({ value: 0.5, velocity: 4 }, 1, settle, 1 / 60);
    expect(fast.value).toBeGreaterThan(slow.value);
  });

  it("retargets from the live value without a jump", () => {
    const state = springStep({ value: 0.6, velocity: 1.2 }, 1, settle, 1 / 60);
    const retargeted = springStep(state, 0, settle, 0);
    expect(retargeted.value).toBeCloseTo(state.value, 10);
    expect(retargeted.velocity).toBeCloseTo(state.velocity, 10);
  });

  it("runs on injected frames, ends exactly on the target and reports rest once", () => {
    let time = 0;
    const pending: Array<(timestamp: number) => void> = [];
    const updates: number[] = [];
    let rests = 0;
    runSpring({
      from: 0,
      to: 1,
      spec: settle,
      onUpdate: (value) => updates.push(value),
      onRest: () => {
        rests += 1;
      },
      requestFrame: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      cancelFrame: () => undefined,
    });
    while (pending.length > 0 && time < 5_000) {
      time += 16;
      pending.shift()?.(time);
    }
    expect(rests).toBe(1);
    expect(updates.at(-1)).toBe(1);
  });

  it("stops without a final update when asked", () => {
    const pending: Array<(timestamp: number) => void> = [];
    const updates: number[] = [];
    const run = runSpring({
      from: 0,
      to: 1,
      spec: settle,
      onUpdate: (value) => updates.push(value),
      onRest: () => undefined,
      requestFrame: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      cancelFrame: () => undefined,
    });
    pending.shift()?.(16);
    run.stop();
    const before = updates.length;
    pending.shift()?.(32);
    expect(updates.length).toBe(before);
  });

  it("tweens to the target for reduced motion", () => {
    const pending: Array<(timestamp: number) => void> = [];
    const updates: number[] = [];
    let rested = false;
    runTween({
      from: 0,
      to: 1,
      durationMs: 200,
      onUpdate: (value) => updates.push(value),
      onRest: () => {
        rested = true;
      },
      requestFrame: (callback) => {
        pending.push(callback);
        return pending.length;
      },
      cancelFrame: () => undefined,
    });
    for (let time = 0; time <= 400 && pending.length > 0; time += 50) pending.shift()?.(time);
    expect(rested).toBe(true);
    expect(updates.at(-1)).toBe(1);
    expect(updates.every((value, index) => index === 0 || value >= (updates[index - 1] ?? 0))).toBe(
      true,
    );
  });
});

describe("cover morph", () => {
  const mini = { left: 16, top: 780, width: 44 };
  const resting = { left: 32, top: 150, width: 326 };
  const morph = computeMorph(mini, resting);

  it("measures the first and last rectangles once", () => {
    expect(morph).toMatchObject({ dx: -16, dy: 630 });
    expect(morph?.scaleAtClosed).toBeCloseTo(44 / 326, 6);
  });

  it("lands on the mini cover when closed and on its resting place when open", () => {
    if (!morph) throw new Error("no morph");
    const height = 844;
    // The panel sits (1 - p) * height lower, so the cover's own translation is what remains.
    const closed = coverFrame(0, morph, height);
    expect(panelOffset(0, height) + closed.y).toBeCloseTo(morph.dy, 6);
    expect(closed.x).toBe(morph.dx);
    expect(closed.scale).toBeCloseTo(morph.scaleAtClosed, 6);
    const open = coverFrame(1, morph, height);
    expect(open.x).toBeCloseTo(0, 10);
    expect(open.y).toBeCloseTo(0, 10);
    expect(open.scale).toBe(1);
  });

  it("clamps overshoot so the sheet cannot rise above the top of the screen", () => {
    if (!morph) throw new Error("no morph");
    expect(coverFrame(1.04, morph, 844)).toEqual(coverFrame(1, morph, 844));
    expect(panelOffset(1.04, 844)).toBe(0);
    expect(cardScale(1.2, 0.96)).toBe(1);
  });

  it("keeps the corner radius true under the scale", () => {
    if (!morph) throw new Error("no morph");
    expect(coverRadius(0, 8, 16, morph.scaleAtClosed) * morph.scaleAtClosed).toBeCloseTo(8, 6);
    expect(coverRadius(1, 8, 16, 1)).toBe(16);
  });

  it("returns null when either rectangle has no size", () => {
    expect(computeMorph({ left: 0, top: 0, width: 0 }, resting)).toBeNull();
    expect(computeMorph(mini, { left: 0, top: 0, width: 0 })).toBeNull();
  });

  it("scales a wide-layout card from the enter scale", () => {
    expect(cardScale(0, 0.96)).toBe(0.96);
    expect(cardScale(0.5, 0.96)).toBeCloseTo(0.98, 6);
  });
});
