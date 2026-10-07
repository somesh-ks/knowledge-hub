import { describe, expect, it } from "vitest";
import {
  bubbleLeft,
  crossedBoundary,
  detentGain,
  fractionFromPointer,
  fractionOfTime,
  scrubberValueText,
  scrubKeyAction,
  shouldFireDetent,
  timeFromPointer,
} from "./scrubberMath";
import { makeDigest } from "./testing";
import { buildTimeline } from "./timeline";

describe("pointer to time", () => {
  it("maps the pointer to a fraction and clamps outside the track", () => {
    expect(fractionFromPointer(150, 50, 200)).toBe(0.5);
    expect(fractionFromPointer(10, 50, 200)).toBe(0);
    expect(fractionFromPointer(900, 50, 200)).toBe(1);
    expect(fractionFromPointer(10, 0, 0)).toBe(0);
  });

  it("scales the fraction by the duration", () => {
    expect(timeFromPointer(150, 50, 200, 120)).toBe(60);
    expect(fractionOfTime(30, 120)).toBe(0.25);
    expect(fractionOfTime(30, 0)).toBe(0);
    expect(fractionOfTime(500, 120)).toBe(1);
  });

  it("keeps the bubble inside the track", () => {
    expect(bubbleLeft(5, 80, 300)).toBe(0);
    expect(bubbleLeft(150, 80, 300)).toBe(110);
    expect(bubbleLeft(299, 80, 300)).toBe(220);
    expect(bubbleLeft(10, 400, 300)).toBe(0);
  });
});

describe("keyboard", () => {
  it("seeks five seconds with arrows and fifteen with shift", () => {
    expect(scrubKeyAction("ArrowRight", false, 20, 120)).toEqual({ kind: "seek", seconds: 25 });
    expect(scrubKeyAction("ArrowUp", false, 20, 120)).toEqual({ kind: "seek", seconds: 25 });
    expect(scrubKeyAction("ArrowLeft", true, 20, 120)).toEqual({ kind: "seek", seconds: 5 });
    expect(scrubKeyAction("ArrowDown", false, 2, 120)).toEqual({ kind: "seek", seconds: 0 });
    expect(scrubKeyAction("ArrowRight", true, 115, 120)).toEqual({ kind: "seek", seconds: 120 });
  });

  it("moves by item with the page keys and to the ends with home and end", () => {
    expect(scrubKeyAction("PageDown", false, 0, 120)).toEqual({ kind: "item", direction: "next" });
    expect(scrubKeyAction("PageUp", false, 0, 120)).toEqual({
      kind: "item",
      direction: "previous",
    });
    expect(scrubKeyAction("Home", false, 50, 120)).toEqual({ kind: "seek", seconds: 0 });
    expect(scrubKeyAction("End", false, 50, 120)).toEqual({ kind: "seek", seconds: 120 });
  });

  it("leaves every other key to the browser, space and k included", () => {
    expect(scrubKeyAction(" ", false, 0, 120)).toBeNull();
    expect(scrubKeyAction("k", false, 0, 120)).toBeNull();
    expect(scrubKeyAction("Tab", false, 0, 120)).toBeNull();
  });
});

describe("detents", () => {
  const timeline = buildTimeline(makeDigest());

  it("reports the later item's start as the crossed boundary, in either direction", () => {
    expect(crossedBoundary(timeline, 0, 1)).toBe(30);
    expect(crossedBoundary(timeline, 2, 1)).toBe(60);
    expect(crossedBoundary(timeline, 1, 1)).toBeNull();
    expect(crossedBoundary(null, 0, 1)).toBeNull();
  });

  it("ignores a boundary inside the hysteresis of the last detent", () => {
    expect(shouldFireDetent(30, null, 0.02, 120)).toBe(true);
    expect(shouldFireDetent(30, 30, 0.02, 120)).toBe(false);
    expect(shouldFireDetent(31, 30, 0.02, 120)).toBe(false);
    expect(shouldFireDetent(60, 30, 0.02, 120)).toBe(true);
  });

  it("softens ticks as the pointer speeds up, never below 0.4", () => {
    expect(detentGain(0.1)).toBe(1);
    expect(detentGain(1.5)).toBeLessThan(1);
    expect(detentGain(1.5)).toBeGreaterThan(0.4);
    expect(detentGain(40)).toBe(0.4);
    expect(detentGain(-0.1)).toBe(1);
  });
});

describe("aria", () => {
  it("describes the position, section and item for a screen reader", () => {
    expect(scrubberValueText(86, 211, "Interaction craft", 4, 12)).toBe(
      "1:26 of 3:31, Interaction craft, item 5 of 12",
    );
    expect(scrubberValueText(86, 211, "", 0, 0)).toBe("1:26 of 3:31");
  });
});
