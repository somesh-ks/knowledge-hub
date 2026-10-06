import { DigestId } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { allocateDigestId } from "../src/gate/allocateDigestId.js";
import { fetchWindow } from "../src/gate/fetchWindow.js";

const DAY = 86_400_000;
const now = new Date("2026-10-07T05:13:00Z");

describe("fetchWindow", () => {
  it("starts at the last successful fetch and ends now", () => {
    const lastFetchAt = new Date("2026-10-05T05:13:00Z");
    const window = fetchWindow({ lastFetchAt, now, kind: "regular" });
    expect(window.from).toEqual(lastFetchAt);
    expect(window.to).toEqual(now);
  });

  it("looks back three days on the first run", () => {
    const window = fetchWindow({ lastFetchAt: undefined, now, kind: "regular" });
    expect(window.to.getTime() - window.from.getTime()).toBe(3 * DAY);
  });

  it("caps the window at seven days after a long gap", () => {
    const window = fetchWindow({
      lastFetchAt: new Date("2026-09-01T00:00:00Z"),
      now,
      kind: "regular",
    });
    expect(window.to.getTime() - window.from.getTime()).toBe(7 * DAY);
  });

  it("allows exactly seven days without trimming", () => {
    const lastFetchAt = new Date(now.getTime() - 7 * DAY);
    expect(fetchWindow({ lastFetchAt, now, kind: "regular" }).from).toEqual(lastFetchAt);
  });

  it("always covers seven days for the weekly pass, even right after a fetch", () => {
    const recent = new Date(now.getTime() - 3_600_000);
    const window = fetchWindow({ lastFetchAt: recent, now, kind: "weekly" });
    expect(window.to.getTime() - window.from.getTime()).toBe(7 * DAY);
    expect(fetchWindow({ lastFetchAt: undefined, now, kind: "weekly" }).from.getTime()).toBe(
      now.getTime() - 7 * DAY,
    );
  });

  it("treats an on-demand run like a regular one, starting at the last fetch", () => {
    const lastFetchAt = new Date("2026-10-06T05:13:00Z");
    expect(fetchWindow({ lastFetchAt, now, kind: "on-demand" }).from).toEqual(lastFetchAt);
  });

  it("clamps a last fetch that lies in the future to now", () => {
    const window = fetchWindow({
      lastFetchAt: new Date(now.getTime() + 60_000),
      now,
      kind: "regular",
    });
    expect(window.from).toEqual(now);
  });

  it("counts elapsed time, so the cap is exact across a daylight saving change", () => {
    const afterChange = new Date("2026-10-26T06:13:00Z");
    const window = fetchWindow({
      lastFetchAt: new Date("2026-10-01T00:00:00Z"),
      now: afterChange,
      kind: "regular",
    });
    expect(window.from.getTime()).toBe(afterChange.getTime() - 7 * DAY);
  });
});

describe("allocateDigestId", () => {
  const date = "2026-10-07";

  it("uses the plain date for the first regular digest of a day", () => {
    expect(allocateDigestId(date, "regular", [])).toBe("2026-10-07");
  });

  it("uses -weekly for the weekly pass", () => {
    expect(allocateDigestId("2026-10-11", "weekly", [])).toBe("2026-10-11-weekly");
  });

  it("gives a weekly pass its own id even when the day's regular digest exists", () => {
    expect(allocateDigestId("2026-10-11", "weekly", ["2026-10-11"])).toBe("2026-10-11-weekly");
  });

  it("takes -2, -3 and so on for further runs on the same day", () => {
    expect(allocateDigestId(date, "on-demand", [date])).toBe("2026-10-07-2");
    expect(allocateDigestId(date, "regular", [date, "2026-10-07-2"])).toBe("2026-10-07-3");
    expect(allocateDigestId(date, "on-demand", [date, "2026-10-07-2", "2026-10-07-3"])).toBe(
      "2026-10-07-4",
    );
  });

  it("hands the plain date to an on-demand run when no digest exists yet", () => {
    expect(allocateDigestId(date, "on-demand", [])).toBe(date);
  });

  it("never reuses an id, even when there are gaps", () => {
    expect(allocateDigestId(date, "regular", [date, "2026-10-07-3"])).toBe("2026-10-07-2");
    expect(allocateDigestId(date, "regular", ["2026-10-07-2"])).toBe(date);
  });

  it("falls back to a numeric suffix when the weekly id is already taken", () => {
    expect(allocateDigestId("2026-10-11", "weekly", ["2026-10-11", "2026-10-11-weekly"])).toBe(
      "2026-10-11-2",
    );
  });

  it("ignores ids from other days", () => {
    expect(allocateDigestId(date, "regular", ["2026-10-06", "2026-10-06-2", "2026-10-08"])).toBe(
      date,
    );
  });

  it("accepts any iterable and always returns a valid core DigestId", () => {
    const taken = new Set([date, ...Array.from({ length: 10 }, (_, i) => `${date}-${i + 2}`)]);
    const id = allocateDigestId(date, "on-demand", taken);
    expect(id).toBe("2026-10-07-12");
    expect(DigestId.safeParse(id).success).toBe(true);
  });
});
