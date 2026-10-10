import { describe, expect, it } from "vitest";
import {
  daysBetweenDates,
  STALE_AFTER_DAYS,
  staleAge,
  staleFrom,
  staleTitle,
  todayInStockholm,
} from "./staleness";

describe("todayInStockholm", () => {
  it("uses the Stockholm calendar, not UTC", () => {
    // 23:30 UTC on 6 October is 01:30 on 7 October in Stockholm (UTC+2).
    expect(todayInStockholm(new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-07");
    expect(todayInStockholm(new Date("2026-10-06T10:00:00Z"))).toBe("2026-10-06");
  });

  it("follows the winter offset too", () => {
    // 23:30 UTC on 6 December is 00:30 on 7 December in Stockholm (UTC+1).
    expect(todayInStockholm(new Date("2026-12-06T23:30:00Z"))).toBe("2026-12-07");
  });
});

describe("daysBetweenDates", () => {
  it("counts whole calendar days", () => {
    expect(daysBetweenDates("2026-10-03", "2026-10-07")).toBe(4);
    expect(daysBetweenDates("2026-10-07", "2026-10-07")).toBe(0);
    expect(daysBetweenDates("2026-10-07", "2026-10-03")).toBe(-4);
  });

  it("crosses month and year ends", () => {
    expect(daysBetweenDates("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("staleAge", () => {
  it("is not stale within the cadence", () => {
    expect(staleAge("2026-10-07", "2026-10-07")).toBeNull();
    expect(staleAge("2026-10-07", "2026-10-10")).toBeNull();
  });

  it("is stale once older than the allowance", () => {
    expect(STALE_AFTER_DAYS).toBe(3);
    expect(staleAge("2026-10-07", "2026-10-11")).toBe(4);
  });

  it("is not stale for a date in the future, as in a clock set back", () => {
    expect(staleAge("2026-10-07", "2026-10-01")).toBeNull();
  });
});

describe("staleFrom", () => {
  it("is the first day staleAge calls stale, and the day before is not", () => {
    for (const date of ["2026-10-07", "2026-10-29", "2026-12-30", "2028-02-27"]) {
      const first = staleFrom(date);
      const before = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString();
      expect(staleAge(date, first)).toBe(STALE_AFTER_DAYS + 1);
      expect(staleAge(date, before.slice(0, 10))).toBeNull();
    }
  });

  it("crosses month and year ends", () => {
    expect(staleFrom("2026-10-29")).toBe("2026-11-02");
    expect(staleFrom("2026-12-30")).toBe("2027-01-03");
  });
});

describe("staleTitle", () => {
  it("states the age", () => {
    expect(staleTitle(4)).toBe("This briefing is 4 days old");
  });
});
