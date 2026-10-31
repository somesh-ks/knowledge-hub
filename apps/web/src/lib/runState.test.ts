import { describe, expect, it } from "vitest";
import { NO_RUN, summarizeLastRun } from "./runState";

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
