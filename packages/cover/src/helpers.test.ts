import { describe, expect, it } from "vitest";
import { circleHitsQuiet } from "./place.js";
import { linePath, n, nonFiniteCount, pad, rectPath } from "./svg.js";
import type { Ctx, Rect } from "./types.js";

/** Only the fields the placement helpers read. */
function fakeCtx(quiet: Rect[]): Ctx {
  return { quiet, u: 1, w: 1024, h: 1024 } as unknown as Ctx;
}

describe("number formatting", () => {
  it("rounds, trims zeros and never prints -0", () => {
    expect(n(1.2345)).toBe("1.2");
    expect(n(3)).toBe("3");
    expect(n(2.5, 2)).toBe("2.5");
    expect(n(-0.04)).toBe("0");
  });

  it("sanitizes NaN and Infinity to 0 and counts them", () => {
    const before = nonFiniteCount();
    expect(n(Number.NaN)).toBe("0");
    expect(n(Number.POSITIVE_INFINITY)).toBe("0");
    expect(nonFiniteCount()).toBe(before + 2);
  });
});

describe("path builders", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("builds polylines, open and closed", () => {
    expect(linePath(points)).toBe("M0 0L10 0L10 10L0 10");
    expect(linePath(points, true)).toBe("M0 0L10 0L10 10L0 10Z");
    expect(linePath([])).toBe("");
  });

  it("builds rectangles and padded rectangles", () => {
    expect(rectPath({ x: 1, y: 2, w: 3, h: 4 })).toBe("M1 2h3v4h-3Z");
    expect(pad({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });
});

describe("placement", () => {
  const ctx = fakeCtx([{ x: 100, y: 700, w: 300, h: 250 }]);

  it("knows when a circle is in a type zone", () => {
    expect(circleHitsQuiet(ctx, { x: 450, y: 800 }, 60)).toBe(true);
    expect(circleHitsQuiet(ctx, { x: 700, y: 200 }, 60)).toBe(false);
  });
});
