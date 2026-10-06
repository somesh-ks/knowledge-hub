import { describe, expect, it } from "vitest";
import { circleHitsQuiet, clearOfQuiet, inQuiet, quietFade } from "./place.js";
import {
  knockoutClip,
  linePath,
  n,
  nonFiniteCount,
  pad,
  rectPath,
  smoothPath,
  softKnockout,
} from "./svg.js";
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

  it("builds a smooth spline through every point", () => {
    const d = smoothPath(points, true);
    expect(d.startsWith("M0 0C")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(4);
    expect(smoothPath(points.slice(0, 2))).toBe(linePath(points.slice(0, 2)));
  });

  it("builds rectangles and padded rectangles", () => {
    expect(rectPath({ x: 1, y: 2, w: 3, h: 4 })).toBe("M1 2h3v4h-3Z");
    expect(pad({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 });
  });
});

describe("knockouts", () => {
  const area = { x: 0, y: 0, w: 100, h: 100 };
  const hole = { x: 10, y: 10, w: 20, h: 20 };

  it("cuts a hard hole with an even-odd clip", () => {
    const clip = knockoutClip("k", area, [hole]);
    expect(clip).toContain('clip-rule="evenodd"');
    expect(clip).toContain('id="k"');
  });

  it("fades art out with a gradient mask instead, and never uses a filter", () => {
    const mask = softKnockout("m", area, [hole], 4);
    expect(mask).toContain('<mask id="m"');
    expect(mask).toContain("linearGradient");
    expect(mask).toContain("radialGradient");
    expect(mask).not.toMatch(/filter|feGaussianBlur/);
    // Nine slices per hole: core, four edges, four corners.
    expect((mask.match(/<rect /g) ?? []).length).toBe(1 + 9);
  });
});

describe("placement", () => {
  const ctx = fakeCtx([{ x: 100, y: 700, w: 300, h: 250 }]);

  it("knows when a point or circle is in a type zone", () => {
    expect(inQuiet(ctx, { x: 200, y: 800 })).toBe(true);
    expect(inQuiet(ctx, { x: 600, y: 200 })).toBe(false);
    expect(circleHitsQuiet(ctx, { x: 450, y: 800 }, 60)).toBe(true);
    expect(circleHitsQuiet(ctx, { x: 700, y: 200 }, 60)).toBe(false);
  });

  it("pushes a circle clear of the type", () => {
    const moved = clearOfQuiet(ctx, { x: 250, y: 800 }, 80, 20);
    expect(circleHitsQuiet(ctx, moved, 80, 19)).toBe(false);
  });

  it("leaves a circle that is already clear where it is", () => {
    expect(clearOfQuiet(ctx, { x: 700, y: 200 }, 80)).toEqual({ x: 700, y: 200 });
  });

  it("fades fields to nothing inside the type zone and to full strength far away", () => {
    expect(quietFade(ctx, { x: 200, y: 800 }, 150)).toBe(0);
    expect(quietFade(ctx, { x: 800, y: 100 }, 150)).toBe(1);
    const mid = quietFade(ctx, { x: 450, y: 800 }, 100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
