import { describe, expect, it } from "vitest";
import { isoWeek, type QueueWords, queueName, queueNames } from "./queueNames";

const words: QueueWords = {
  daily: "Daily podcast",
  weekly: "Weekly podcast",
  podcast: "Podcast",
  catchUp: "Catch up",
};

const row = (
  kind: "catch_up" | "regenerate",
  target: string | null,
  started_at = "2026-10-07T12:00:00Z",
) => ({ kind, target, started_at });

describe("the name of a queue row", () => {
  // The week number is read off the digest id, so it must follow ISO 8601 where a year turns: the
  // last days of December can be week 1 of the next year, and the first of January week 53.
  it("counts the ISO week across a year's end", () => {
    expect(isoWeek(2026, 12, 28)).toBe(53);
    expect(isoWeek(2027, 1, 3)).toBe(53);
    expect(isoWeek(2027, 1, 4)).toBe(1);
    expect(isoWeek(2024, 12, 30)).toBe(1);
    expect(isoWeek(2026, 10, 11)).toBe(41);
  });

  it("names a regeneration for the podcast it replaces, never for the episode's own title", () => {
    expect(queueName(row("regenerate", "2026-10-07"), words)).toBe("Daily podcast · 7 Oct");
    expect(queueName(row("regenerate", "2026-10-11-weekly"), words)).toBe("Weekly podcast · W41");
    expect(queueName(row("regenerate", "2026-09-03-2"), words)).toBe("Podcast · 3 Sep");
    expect(queueName(row("regenerate", "ep-20261207-1405"), words)).toBe("Catch up · 7 Dec");
  });

  it("names a Catch up for the day it was started in the browser's zone, and a regeneration without a target the same way", () => {
    // 23:30 in Stockholm is 21:30 UTC; in Tokyo it is already the next day.
    const late = "2026-10-07T21:30:00Z";
    expect(queueName(row("catch_up", null, late), words, "Europe/Stockholm")).toBe(
      "Catch up · 7 Oct",
    );
    expect(queueName(row("catch_up", null, late), words, "Asia/Tokyo")).toBe("Catch up · 8 Oct");
    expect(queueName(row("regenerate", null, late), words, "UTC")).toBe("Podcast · 7 Oct");
  });

  it("adds the start time only to the names that would read the same", () => {
    const names = queueNames(
      [
        row("catch_up", null, "2026-10-07T12:05:00Z"),
        row("catch_up", null, "2026-10-07T20:40:00Z"),
        row("regenerate", "2026-10-07"),
      ],
      words,
      "UTC",
    );
    expect(names).toEqual([
      "Catch up · 7 Oct · 12:05",
      "Catch up · 7 Oct · 20:40",
      "Daily podcast · 7 Oct",
    ]);
  });

  it("ignores a target that is not an id", () => {
    expect(queueName(row("regenerate", "../../etc/passwd"), words, "UTC")).toBe("Podcast · 7 Oct");
  });
});
