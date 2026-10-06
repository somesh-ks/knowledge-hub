import { describe, expect, it } from "vitest";
import { NO_RUN, showsNothingBanner, summarizeLastRun } from "./runState";

describe("summarizeLastRun", () => {
  it("knows nothing for a missing file", () => {
    expect(summarizeLastRun(null)).toEqual(NO_RUN);
    expect(summarizeLastRun({ version: 1 })).toEqual(NO_RUN);
  });

  it("takes the newest record among all kinds of run", () => {
    const summary = summarizeLastRun({
      version: 1,
      regular: {
        at: "2026-10-05T05:00:00.000Z",
        outcome: "published",
        digest_id: "2026-10-05",
        items: 9,
      },
      weekly: {
        at: "2026-10-04T06:00:00.000Z",
        outcome: "published",
        digest_id: "2026-10-04-weekly",
        items: 14,
      },
      on_demand: { at: "2026-10-07T09:00:00.000Z", outcome: "nothing", items: 0 },
    });
    expect(summary).toEqual({ outcome: "nothing", at: "2026-10-07T09:00:00.000Z", digestId: null });
  });

  it("carries the digest id of a published run", () => {
    const summary = summarizeLastRun({
      version: 1,
      regular: {
        at: "2026-10-07T05:20:00.000Z",
        outcome: "published",
        digest_id: "2026-10-07",
        items: 12,
      },
    });
    expect(summary.digestId).toBe("2026-10-07");
  });
});

describe("showsNothingBanner", () => {
  const nothing = { outcome: "nothing", at: "2026-10-07T05:30:00.000Z", digestId: null } as const;

  it("shows when nothing was found after the latest digest", () => {
    expect(showsNothingBanner(nothing, "2026-10-05T05:20:00.000Z")).toBe(true);
  });

  it("clears once a digest is newer than the empty run", () => {
    expect(showsNothingBanner(nothing, "2026-10-07T09:00:00.000Z")).toBe(false);
  });

  it("stays quiet for every other outcome", () => {
    for (const outcome of ["published", "gated", "failed"] as const) {
      expect(showsNothingBanner({ ...nothing, outcome }, "2026-10-05T05:20:00.000Z")).toBe(false);
    }
    expect(showsNothingBanner(NO_RUN, null)).toBe(false);
  });

  it("shows even with no digest at all", () => {
    expect(showsNothingBanner(nothing, null)).toBe(true);
  });
});
