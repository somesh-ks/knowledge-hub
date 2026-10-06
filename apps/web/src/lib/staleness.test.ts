import { describe, expect, it } from "vitest";
import {
  daysBetweenDates,
  STALE_AFTER_DAYS,
  staleAge,
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

describe("staleTitle", () => {
  it("states the age", () => {
    expect(staleTitle(4)).toBe("This briefing is 4 days old");
  });
});
