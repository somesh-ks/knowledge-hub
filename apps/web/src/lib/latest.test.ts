import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { buildLatest, newestItem } from "./latest";
import { NO_RUN } from "./runState";
import type { Site } from "./site";

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

describe("newestItem", () => {
  const entries = buildEntries(
    ["2026-10-25"].map((id) => ({ digest: makeDigest({ id }), timeline: null })),
  );
  const episodeAt = (generated_at: string) =>
    [{ id: "ep-1", episode: { generated_at } }] as unknown as Site["episodes"];

  it("is the catch-up episode made after the daily briefing, not the briefing", () => {
    const at = entries[0]?.digest.generated_at ?? "";
    const later = new Date(Date.parse(at) + 60_000).toISOString();
    expect(newestItem({ entries, episodes: episodeAt(later) })).toEqual({
      kind: "episode",
      id: "ep-1",
    });
  });

  it("skips an episode this device deleted and picks the next newest", () => {
    const at = entries[0]?.digest.generated_at ?? "";
    const later = new Date(Date.parse(at) + 60_000).toISOString();
    expect(newestItem({ entries, episodes: episodeAt(later) }, new Set(["ep-1"]))).toEqual({
      kind: "digest",
      id: "2026-10-25",
    });
  });

  it("stays the briefing when it is newer than every episode", () => {
    expect(newestItem({ entries, episodes: episodeAt("2000-01-01T00:00:00.000Z") })).toEqual({
      kind: "digest",
      id: "2026-10-25",
    });
  });
});
