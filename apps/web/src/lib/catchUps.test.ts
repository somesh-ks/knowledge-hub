import { describe, expect, it } from "vitest";
import { catchUpAlbum } from "./catchUps";

const entry = (id: string, generated_at: string, date: string) => ({
  id,
  episode: { date, generated_at },
});

describe("a day's Catch ups as one album", () => {
  it("holds the episodes of one Stockholm day, earliest first, named Version 1, 2 and so on, and none for a day with one", () => {
    const episodes = [
      entry("late", "2026-10-06T20:00:00Z", "2026-10-06"),
      entry("other-day", "2026-10-07T05:00:00Z", "2026-10-07"),
      entry("early", "2026-10-06T07:00:00Z", "2026-10-06"),
    ];
    expect(catchUpAlbum(episodes, "late")).toEqual([
      { id: "early", label: "Version 1" },
      { id: "late", label: "Version 2" },
    ]);
    expect(catchUpAlbum(episodes, "early")).toEqual(catchUpAlbum(episodes, "late"));
    expect(catchUpAlbum(episodes, "other-day")).toEqual([]);
    expect(catchUpAlbum(episodes, "missing")).toEqual([]);
  });
});
