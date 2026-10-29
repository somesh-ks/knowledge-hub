import { describe, expect, it } from "vitest";
import { albumLabels, catchUpAlbum } from "./catchUps";

const entry = (id: string, generated_at: string, date: string) => ({
  id,
  episode: { date, generated_at },
});

describe("a day's Catch ups as one album", () => {
  it("names each by its start hour in the viewer's own zone, two digits wide, so a name never changes width", () => {
    // 07:05 UTC is 09:05 in Stockholm (summer time) and 12:35 in Delhi; midnight must read 00, never 24.
    expect(albumLabels(["2026-10-06T07:05:00Z"], "Europe/Stockholm")).toEqual(["Catch up at 09"]);
    expect(albumLabels(["2026-10-06T07:05:00Z"], "Asia/Kolkata")).toEqual(["Catch up at 12"]);
    expect(albumLabels(["2026-10-05T22:00:00Z"], "Europe/Stockholm")).toEqual(["Catch up at 00"]);
  });

  it("adds minutes to every name when two start in one hour, so two options never read alike", () => {
    expect(albumLabels(["2026-10-06T12:05:00Z", "2026-10-06T12:50:00Z"], "UTC")).toEqual([
      "Catch up at 12:05",
      "Catch up at 12:50",
    ]);
  });

  it("holds the episodes of one Stockholm day, earliest first, and none for a day with one", () => {
    const episodes = [
      entry("late", "2026-10-06T20:00:00Z", "2026-10-06"),
      entry("other-day", "2026-10-07T05:00:00Z", "2026-10-07"),
      entry("early", "2026-10-06T07:00:00Z", "2026-10-06"),
    ];
    expect(catchUpAlbum(episodes, "late").map((option) => option.id)).toEqual(["early", "late"]);
    expect(catchUpAlbum(episodes, "early")).toEqual(catchUpAlbum(episodes, "late"));
    expect(catchUpAlbum(episodes, "other-day")).toEqual([]);
    expect(catchUpAlbum(episodes, "missing")).toEqual([]);
  });
});
