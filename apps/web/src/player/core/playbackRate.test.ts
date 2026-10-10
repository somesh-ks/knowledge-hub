import { describe, expect, it } from "vitest";
import { isPlaybackRate, toPlaybackRate } from "./playerTypes";

describe("playback speed", () => {
  it("accepts any step from half speed to double", () => {
    for (const rate of [0.5, 0.75, 1, 1.05, 1.25, 1.85, 2]) expect(isPlaybackRate(rate)).toBe(true);
  });

  it("refuses a speed off the range or off a step", () => {
    for (const rate of [0.45, 2.05, 3, 1.03, Number.NaN, "1.5", null]) {
      expect(isPlaybackRate(rate)).toBe(false);
    }
  });

  it("brings a slider's value to the nearest step inside the range", () => {
    expect(toPlaybackRate(1.1500000000000001)).toBe(1.15);
    expect(toPlaybackRate(1.03)).toBe(1.05);
    expect(toPlaybackRate(0.1)).toBe(0.5);
    expect(toPlaybackRate(9)).toBe(2);
  });
});
