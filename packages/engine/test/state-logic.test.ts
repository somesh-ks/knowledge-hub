import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  JudgmentEntry,
  JudgmentsFile,
  LastRunFile,
  RunRecord,
  SeenFile,
  SourcesFile,
} from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceResult } from "../src/fetch/types.js";
import { listDigestIds } from "../src/state/digestIds.js";
import {
  JUDGMENT_RETENTION_DAYS,
  markSeen,
  pruneJudgments,
  pruneSeen,
  SEEN_RETENTION_DAYS,
} from "../src/state/prune.js";
import { recordRun } from "../src/state/runRecord.js";
import { applySourceResults, failingSources } from "../src/state/sourceHealth.js";
import { CATEGORY_PROBS, makeSource } from "./fetch-helpers.js";

const NOW = new Date("2026-10-06T10:00:00Z");
const DAY = 86_400_000;

describe("pruneSeen", () => {
  const dateAgo = (days: number): string =>
    new Date(NOW.getTime() - days * DAY).toISOString().slice(0, 10);

  it("keeps entries up to 90 days old and drops older ones", () => {
    const seen: SeenFile = {
      version: 1,
      items: {
        today: dateAgo(0),
        edge: dateAgo(SEEN_RETENTION_DAYS),
        over: dateAgo(SEEN_RETENTION_DAYS + 1),
        old: "2025-01-01",
      },
    };
    expect(Object.keys(pruneSeen(seen, NOW).items).sort()).toEqual(["edge", "today"]);
  });

  it("measures age in Stockholm days", () => {
    // 23:30Z on 6 October is already 7 October in Stockholm, so 2026-07-09 is 90 days old.
    const lateNow = new Date("2026-10-06T23:30:00Z");
    const seen: SeenFile = { version: 1, items: { a: "2026-07-09", b: "2026-07-08" } };
    expect(Object.keys(pruneSeen(seen, lateNow).items)).toEqual(["a"]);
  });

  it("does not mutate its input", () => {
    const seen: SeenFile = { version: 1, items: { old: "2025-01-01" } };
    pruneSeen(seen, NOW);
    expect(seen.items).toEqual({ old: "2025-01-01" });
  });
});

describe("pruneJudgments", () => {
  const entry = (judgedAt: string): JudgmentEntry => ({
    item_id: "abc123def456",
    model: "jev",
    questions_hash: "q",
    judged_at: judgedAt,
    category_probs: CATEGORY_PROBS,
    craft_depth: 0.5,
    flags: { hype: 0, sponsored: 0, funding: 0 },
  });

  it("keeps judgments up to 30 days old and drops older ones", () => {
    const at = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();
    const file: JudgmentsFile = {
      version: 1,
      entries: {
        fresh: entry(at(1)),
        edge: entry(at(JUDGMENT_RETENTION_DAYS)),
        stale: entry(at(JUDGMENT_RETENTION_DAYS + 1)),
      },
    };
    expect(Object.keys(pruneJudgments(file, NOW).entries).sort()).toEqual(["edge", "fresh"]);
  });

  it("treats an unreadable timestamp as expired", () => {
    expect(pruneJudgments({ version: 1, entries: { bad: entry("garbage") } }, NOW).entries).toEqual(
      {},
    );
  });
});

describe("markSeen", () => {
  it("adds ids with the given date and keeps earlier dates", () => {
    const seen: SeenFile = { version: 1, items: { a: "2026-10-01" } };
    const next = markSeen(seen, ["a", "b"], "2026-10-06");
    expect(next.items).toEqual({ a: "2026-10-01", b: "2026-10-06" });
    expect(seen.items).toEqual({ a: "2026-10-01" });
  });
});

describe("recordRun", () => {
  const published: RunRecord = {
    at: "2026-10-07T05:13:00.000Z",
    outcome: "published",
    digest_id: "2026-10-07",
    items: 11,
  };
  const through = new Date("2026-10-07T05:13:00Z");

  it("records a published regular run and advances the fetch window", () => {
    const next = recordRun(
      { version: 1 },
      { kind: "regular", record: published, fetchedThrough: through },
    );
    expect(next.regular).toEqual({ ...published, fetched_through: "2026-10-07T05:13:00.000Z" });
    expect(next.last_fetch_at).toBe("2026-10-07T05:13:00.000Z");
  });

  it("keeps one slot per kind, so on-demand never shifts the regular cadence", () => {
    const base: LastRunFile = { version: 1, regular: published };
    const onDemand: RunRecord = {
      ...published,
      at: "2026-10-08T10:00:00.000Z",
      digest_id: "2026-10-08-2",
    };
    const next = recordRun(base, { kind: "on-demand", record: onDemand });
    expect(next.regular).toEqual(published);
    expect(next.on_demand).toEqual(onDemand);
    const weekly = recordRun(next, {
      kind: "weekly",
      record: { ...published, digest_id: "2026-10-11-weekly" },
    });
    expect(weekly.weekly?.digest_id).toBe("2026-10-11-weekly");
  });

  it("records a run that found nothing and still advances the window", () => {
    const nothing: RunRecord = { at: published.at, outcome: "nothing", items: 0 };
    const next = recordRun(
      { version: 1 },
      { kind: "regular", record: nothing, fetchedThrough: through },
    );
    expect(next.regular?.outcome).toBe("nothing");
    expect(next.last_fetch_at).toBeDefined();
  });

  it("leaves last-run.json untouched after a failed run, so the next window grows", () => {
    const base: LastRunFile = {
      version: 1,
      regular: published,
      last_fetch_at: "2026-10-05T05:13:00.000Z",
    };
    const failed: RunRecord = { at: "2026-10-09T05:13:00.000Z", outcome: "failed", items: 0 };
    expect(recordRun(base, { kind: "regular", record: failed, fetchedThrough: through })).toBe(
      base,
    );
  });

  it("records nothing for a gated run", () => {
    const base: LastRunFile = { version: 1 };
    const gated: RunRecord = { at: published.at, outcome: "gated", items: 0 };
    expect(recordRun(base, { kind: "regular", record: gated, fetchedThrough: through })).toBe(base);
  });

  it("never moves the window start backwards", () => {
    const base: LastRunFile = { version: 1, last_fetch_at: "2026-10-09T00:00:00.000Z" };
    const next = recordRun(base, { kind: "regular", record: published, fetchedThrough: through });
    expect(next.last_fetch_at).toBe("2026-10-09T00:00:00.000Z");
  });

  it("does not touch the window when no fetch end is given", () => {
    const next = recordRun(
      { version: 1, last_fetch_at: "2026-10-05T00:00:00.000Z" },
      { kind: "regular", record: published },
    );
    expect(next.last_fetch_at).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("source health", () => {
  const file: SourcesFile = {
    version: 1,
    sources: [
      makeSource({ id: "ok", failures: 3 }),
      makeSource({ id: "bad", failures: 1 }),
      makeSource({ id: "skipped", failures: 2 }),
      makeSource({ id: "untouched", failures: 4 }),
    ],
  };
  const results: SourceResult[] = [
    { source_id: "ok", ok: true, count: 5, ms: 10 },
    { source_id: "bad", ok: false, count: 0, ms: 10, error: "HTTP 500" },
    { source_id: "skipped", ok: true, count: 0, ms: 1, note: "FIRECRAWL_API_KEY is not set" },
  ];

  it("resets failures and stamps last_ok on success, increments on failure", () => {
    const next = applySourceResults(file, results, NOW);
    const byId = Object.fromEntries(next.sources.map((s) => [s.id, s]));
    expect(byId.ok).toMatchObject({ failures: 0, last_ok: NOW.toISOString() });
    expect(byId.bad?.failures).toBe(2);
    expect(byId.bad?.last_ok).toBeUndefined();
  });

  it("leaves skipped sources and sources outside the pass alone", () => {
    const next = applySourceResults(file, results, NOW);
    expect(next.sources.find((s) => s.id === "skipped")).toEqual(file.sources[2]);
    expect(next.sources.find((s) => s.id === "untouched")).toEqual(file.sources[3]);
  });

  it("does not mutate the original registry", () => {
    applySourceResults(file, results, NOW);
    expect(file.sources[0]?.failures).toBe(3);
  });

  it("flags enabled sources failing five runs in a row", () => {
    const flagged: SourcesFile = {
      version: 1,
      sources: [
        makeSource({ id: "a", failures: 5 }),
        makeSource({ id: "b", failures: 4 }),
        makeSource({ id: "c", failures: 9, enabled: false }),
      ],
    };
    expect(failingSources(flagged).map((s) => s.id)).toEqual(["a"]);
    expect(failingSources(flagged, 4).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("listDigestIds", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "singularity-digests-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns an empty list when there is no Digests directory", async () => {
    expect(await listDigestIds(root)).toEqual([]);
  });

  it("lists digest ids from Digests/YYYY/MM and ignores everything else", async () => {
    await mkdir(join(root, "Digests/2026/10"), { recursive: true });
    await mkdir(join(root, "Digests/2026/09"), { recursive: true });
    for (const file of [
      "2026-10-05.md",
      "2026-10-07-2.md",
      "2026-10-11-weekly.md",
      "2026-10-05.audio.json",
      "notes.md",
    ]) {
      await writeFile(join(root, "Digests/2026/10", file), "x");
    }
    await writeFile(join(root, "Digests/2026/09/2026-09-30.md"), "x");
    await writeFile(join(root, "Digests/README.md"), "x");
    expect(await listDigestIds(root)).toEqual([
      "2026-09-30",
      "2026-10-05",
      "2026-10-07-2",
      "2026-10-11-weekly",
    ]);
  });
});
