import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { groupArchive } from "./archive";
import { buildEntries } from "./digests";

function entries(ids: string[]) {
  return buildEntries(ids.map((id) => ({ digest: makeDigest({ id }), timeline: null })));
}

describe("groupArchive", () => {
  it("returns nothing for no briefings", () => {
    expect(groupArchive([])).toEqual([]);
  });

  it("groups by year, then month, newest first", () => {
    const years = groupArchive(
      entries(["2026-10-07", "2026-10-05", "2026-09-30", "2026-09-01", "2025-12-24"]),
    );
    expect(years.map((year) => year.year)).toEqual(["2026", "2025"]);
    expect(years[0]?.months.map((month) => month.label)).toEqual(["October", "September"]);
    expect(years[0]?.months[0]?.entries.map((entry) => entry.id)).toEqual([
      "2026-10-07",
      "2026-10-05",
    ]);
    expect(years[1]?.months[0]).toMatchObject({ key: "2025-12", label: "December" });
  });

  it("keeps a digest with a suffixed id among its days", () => {
    const years = groupArchive(entries(["2026-10-07", "2026-10-04-weekly", "2026-10-03"]));
    const october = years[0]?.months[0];
    expect(october?.entries.map((entry) => entry.id)).toEqual([
      "2026-10-07",
      "2026-10-04-weekly",
      "2026-10-03",
    ]);
  });

  it("counts every briefing exactly once", () => {
    const ids = ["2026-10-07", "2026-10-07-2", "2026-09-30", "2025-01-02"];
    const total = groupArchive(entries(ids))
      .flatMap((year) => year.months)
      .reduce((sum, month) => sum + month.entries.length, 0);
    expect(total).toBe(ids.length);
  });
});
