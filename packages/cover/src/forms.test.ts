import { describe, expect, it } from "vitest";
import { MONTH_NAMES, parseDate } from "./context.js";
import { layoutLockup, MARGIN_UNITS } from "./lockup.js";
import { CAP_HEIGHT, measureNumeral } from "./metrics.js";

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

  it("keeps every piece of lockup type inside the safe margin for every date", () => {
    for (const margin of [MARGIN_UNITS, MARGIN_UNITS + 44]) {
      for (let day = 1; day <= 31; day += 1) {
        for (const month of MONTH_NAMES) {
          const { date, mark, month: topMonth } = layoutLockup(1024, 1024, 1, day, month, margin);
          for (const r of [date, mark, topMonth]) {
            expect(r.x, `${day} ${month}`).toBeGreaterThanOrEqual(margin - 1);
            expect(r.y).toBeGreaterThanOrEqual(margin - 1);
            expect(r.x + r.w).toBeLessThanOrEqual(1024 - margin + 1);
            expect(r.y + r.h).toBeLessThanOrEqual(1024 - margin + 1);
          }
        }
      }
    }
  });

  it("puts the date bottom left and the wordmark top left, the same on every cover", () => {
    const { date, mark } = layoutLockup(1024, 1024, 1, 6, "October", MARGIN_UNITS);
    expect(date.x).toBe(MARGIN_UNITS);
    expect(date.y + date.h).toBeCloseTo(1024 - MARGIN_UNITS, 5);
    expect(mark.x).toBe(MARGIN_UNITS);
    expect(mark.y).toBe(MARGIN_UNITS);
  });

  it("sets the date far larger than the wordmark", () => {
    const { date, mark } = layoutLockup(1024, 1024, 1, 6, "October", MARGIN_UNITS);
    expect(date.h).toBeGreaterThan(mark.h * 8);
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
