import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { buildLatest } from "./latest";
import { NO_RUN } from "./runState";

describe("buildLatest", () => {
  it("is all null when nothing exists yet", () => {
    expect(buildLatest({ entries: [], lastRun: NO_RUN })).toEqual({
      id: null,
      date: null,
      kind: null,
      generated_at: null,
      episode_at: null,
      episode_id: null,
      outcome: null,
      outcome_at: null,
    });
  });

  it("describes the newest digest and the last run", () => {
    const entries = buildEntries(
      ["2026-10-05", "2026-10-07"].map((id) => ({ digest: makeDigest({ id }), timeline: null })),
    );
    expect(
      buildLatest({
        entries,
        lastRun: { outcome: "published", at: "2026-10-07T05:20:00.000Z", digestId: "2026-10-07" },
      }),
    ).toEqual({
      id: "2026-10-07",
      date: "2026-10-07",
      kind: "regular",
      generated_at: "2026-10-07T05:20:00.000Z",
      episode_at: null,
      episode_id: null,
      outcome: "published",
      outcome_at: "2026-10-07T05:20:00.000Z",
    });
  });

  it("exposes exactly the whitelisted fields and nothing from the digest body", () => {
    const entries = buildEntries([{ digest: makeDigest(), timeline: null }]);
    const body = buildLatest({ entries, lastRun: NO_RUN });
    expect(Object.keys(body).sort()).toEqual([
      "date",
      "episode_at",
      "episode_id",
      "generated_at",
      "id",
      "kind",
      "outcome",
      "outcome_at",
    ]);
    expect(JSON.stringify(body)).not.toContain("example.com");
  });
});
