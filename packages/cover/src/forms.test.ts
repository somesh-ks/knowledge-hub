import { describe, expect, it } from "vitest";
import { MONTH_NAMES, parseDate } from "./context.js";
import { layoutLockup } from "./lockup.js";
import { CAP_HEIGHT, measureNumeral } from "./metrics.js";
import { marchingSquares } from "./templates/contour.js";
import { bayerMatrix } from "./templates/dither.js";
import { springResponse } from "./templates/spring.js";

describe("springResponse", () => {
  it("starts at rest and settles on the target", () => {
    for (const zeta of [0.1, 0.5, 1, 1.4]) {
      expect(springResponse(zeta, 14, 0)).toBe(0);
      expect(springResponse(zeta, 14, 8)).toBeCloseTo(1, 3);
    }
  });

  it("overshoots when underdamped, by the textbook amount", () => {
    const zeta = 0.2;
    const omega = 12;
    const peakTime = Math.PI / (omega * Math.sqrt(1 - zeta * zeta));
    const expected = 1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(springResponse(zeta, omega, peakTime)).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(1.5);
  });

  it("never overshoots when critically damped or overdamped", () => {
    for (const zeta of [1, 1.6]) {
      for (let t = 0; t <= 2; t += 0.02) expect(springResponse(zeta, 12, t)).toBeLessThanOrEqual(1);
    }
  });
});

describe("bayerMatrix", () => {
  it("is a permutation of evenly spaced thresholds", () => {
    const m = bayerMatrix(3)
      .flat()
      .sort((a, b) => a - b);
    expect(m).toHaveLength(64);
    for (const [i, v] of m.entries()) expect(v).toBeCloseTo((i + 0.5) / 64, 10);
  });

  it("puts the first threshold in the corner and spreads neighbors apart", () => {
    const m = bayerMatrix(2);
    expect(m[0]?.[0]).toBeCloseTo(0.5 / 16, 10);
    expect(Math.abs((m[0]?.[0] as number) - (m[0]?.[1] as number))).toBeGreaterThan(0.1);
  });
});

describe("marchingSquares", () => {
  const size = 40;
  const grid = (fn: (x: number, y: number) => number): Float32Array => {
    const out = new Float32Array((size + 1) * (size + 1));
    for (let y = 0; y <= size; y += 1)
      for (let x = 0; x <= size; x += 1) out[y * (size + 1) + x] = fn(x, y);
    return out;
  };

  it("traces one closed loop around a single peak", () => {
    const lines = marchingSquares(
      grid((x, y) => 1 - Math.hypot(x - 20, y - 20) / 20),
      size,
      size,
      0.5,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.closed).toBe(true);
    for (const p of lines[0]?.points ?? [])
      expect(Math.hypot(p.x - 20, p.y - 20)).toBeCloseTo(10, 0);
  });

  it("traces an open line across a ramp", () => {
    const lines = marchingSquares(
      grid((x) => x / size),
      size,
      size,
      0.5,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.closed).toBe(false);
    for (const p of lines[0]?.points ?? []) expect(p.x).toBeCloseTo(20, 5);
  });

  it("finds nothing when the level is outside the field", () => {
    expect(
      marchingSquares(
        grid(() => 0.2),
        size,
        size,
        0.5,
      ),
    ).toEqual([]);
  });
});

describe("typography", () => {
  it("measures digits from font metrics", () => {
    const run = measureNumeral("1", 900, 2048, 0);
    expect(run.advance).toBe(926);
    expect(run.left).toBe(44);
    expect(run.right).toBe(926 - 801);
    expect(measureNumeral("24", 900, 1000, -40).advance).toBeLessThan(
      measureNumeral("24", 900, 1000, 0).advance,
    );
    expect(CAP_HEIGHT).toBeCloseTo(0.703, 3);
    expect(() => measureNumeral("x", 900, 100, 0)).toThrow();
  });

  it("keeps the lockup and wordmark inside the safe margin in every corner", () => {
    const u = 1;
    const margin = 88 * u;
    for (const corner of ["bl", "br", "tl", "tr"] as const) {
      for (let day = 1; day <= 31; day += 1) {
        for (const month of MONTH_NAMES) {
          const { box, markBox } = layoutLockup(1024, 1024, u, corner, day, month, margin);
          for (const r of [box, markBox]) {
            expect(r.x, `${corner} ${day} ${month}`).toBeGreaterThanOrEqual(margin - 1);
            expect(r.y).toBeGreaterThanOrEqual(margin - 1);
            expect(r.x + r.w).toBeLessThanOrEqual(1024 - margin + 1);
            expect(r.y + r.h).toBeLessThanOrEqual(1024 - margin + 1);
          }
        }
      }
    }
  });

  it("places the wordmark in the corner diagonal to the date", () => {
    const { box, markBox } = layoutLockup(1024, 1024, 1, "bl", 6, "October", 88);
    expect(markBox.x).toBeGreaterThan(box.x + box.w);
    expect(markBox.y).toBeLessThan(box.y);
  });
});

describe("parseDate", () => {
  it("reads YYYY-MM-DD and ids with suffixes", () => {
    expect(parseDate("2026-10-06")).toEqual({ year: 2026, month: 10, day: 6 });
    expect(parseDate("2026-10-04-weekly").day).toBe(4);
  });

  it("rejects malformed dates", () => {
    expect(() => parseDate("October 6")).toThrow();
    expect(() => parseDate("2026-13-01")).toThrow();
  });
});
