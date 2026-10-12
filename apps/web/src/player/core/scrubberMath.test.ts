import { describe, expect, it } from "vitest";
import {
  bubbleLeft,
  crossedBoundary,
  detentGain,
  dockSeekKeyValue,
  fractionFromPointer,
  fractionOfTime,
  onPixelGrid,
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

  it("puts the bubble on whole device pixels, so its digits keep one shape as it moves", () => {
    expect(onPixelGrid(101.37, 1)).toBe(101);
    expect(onPixelGrid(101.37, 3)).toBeCloseTo(101.3333, 4);
    expect(onPixelGrid(101.2, 2)).toBe(101);
    expect(onPixelGrid(12.6, 0)).toBe(13);
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

describe("the bar's seek keys", () => {
  it("steps a whole second from the second the playhead is in, as a one-second range did", () => {
    expect(dockSeekKeyValue("ArrowRight", 26.93, 36.05)).toBe(27);
    expect(dockSeekKeyValue("ArrowUp", 26.93, 36.05)).toBe(27);
    expect(dockSeekKeyValue("ArrowLeft", 26.93, 36.05)).toBe(25);
    expect(dockSeekKeyValue("ArrowDown", 0.4, 36.05)).toBe(0);
    expect(dockSeekKeyValue("ArrowRight", 36.02, 36.05)).toBe(36);
  });

  it("moves a tenth of the length with the page keys, rounded to a whole second", () => {
    expect(dockSeekKeyValue("PageUp", 27, 36.05)).toBe(31);
    expect(dockSeekKeyValue("PageDown", 31, 36.05)).toBe(27);
    expect(dockSeekKeyValue("PageUp", 3, 8.5)).toBe(4);
    expect(dockSeekKeyValue("PageDown", 30, 600)).toBe(0);
  });

  it("goes to the start and to the last whole second, and leaves other keys alone", () => {
    expect(dockSeekKeyValue("Home", 20, 36.05)).toBe(0);
    expect(dockSeekKeyValue("End", 20, 36.05)).toBe(36);
    expect(dockSeekKeyValue("Tab", 20, 36.05)).toBeNull();
    expect(dockSeekKeyValue(" ", 20, 36.05)).toBeNull();
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
      "1:26 of 3:31, story 5 of 12, Interaction craft",
    );
    // An episode's stories have no section worth naming.
    expect(scrubberValueText(86, 211, "", 0, 6)).toBe("1:26 of 3:31, story 1 of 6");
    expect(scrubberValueText(86, 211, "", 0, 0)).toBe("1:26 of 3:31");
    // The rundown before story 1 is no story.
    expect(scrubberValueText(5, 211, "", -1, 6)).toBe("0:05 of 3:31");
  });
});
