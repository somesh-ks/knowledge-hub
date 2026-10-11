import { describe, expect, it } from "vitest";
import {
  formatClock,
  longDateTitle,
  monthKeyOf,
  monthName,
  pluralize,
  sinceLabel,
  yearOf,
} from "./format";

describe("formatClock", () => {
  it("writes minutes and zero-padded seconds", () => {
    expect(formatClock(212_000)).toBe("3:32");
    expect(formatClock(62_000)).toBe("1:02");
    expect(formatClock(9_000)).toBe("0:09");
  });

  it("rounds to the nearest second and never goes negative", () => {
    expect(formatClock(1_499)).toBe("0:01");
    expect(formatClock(1_500)).toBe("0:02");
    expect(formatClock(-5_000)).toBe("0:00");
  });

  it("keeps counting minutes past an hour", () => {
    expect(formatClock(3_725_000)).toBe("62:05");
  });
});

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "item")).toBe("1 item");
    expect(pluralize(0, "item")).toBe("0 items");
    expect(pluralize(12, "briefing")).toBe("12 briefings");
  });

  it("takes an explicit plural", () => {
    expect(pluralize(2, "story", "stories")).toBe("2 stories");
  });
});

describe("sinceLabel", () => {
  it("names the weekday when the window opened within a week", () => {
    // Monday 5 October 2026, 07:10 in Stockholm.
    expect(sinceLabel("2026-10-05T05:10:00.000Z", "2026-10-07")).toBe("since Monday");
  });

  it("names the day for a longer window", () => {
    expect(sinceLabel("2026-09-20T05:00:00.000Z", "2026-10-07")).toBe("since 20 September");
  });

  it("says today for a window that opened on the digest's own date", () => {
    expect(sinceLabel("2026-10-07T01:00:00.000Z", "2026-10-07")).toBe("today");
  });

  it("reads the window in Stockholm time, not UTC", () => {
    // 22:30 UTC on the 4th is 00:30 on the 5th in Stockholm (UTC+2 until 25 October).
    expect(sinceLabel("2026-10-04T22:30:00.000Z", "2026-10-07")).toBe("since Monday");
  });
});

describe("archive dates", () => {
  it("splits a date into year and month key", () => {
    expect(yearOf("2026-10-07")).toBe("2026");
    expect(monthKeyOf("2026-10-07")).toBe("2026-10");
  });

  it("writes the month name in English", () => {
    expect(monthName("2026-10")).toBe("October");
    expect(monthName("2026-01")).toBe("January");
  });
});

describe("longDateTitle", () => {
  it("keeps the day with its month: a non-breaking space joins them", () => {
    expect(longDateTitle("2026-10-07")).toBe("Wednesday 7\u00a0October");
  });
});
