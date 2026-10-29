import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { measureCoverage } from "../src/ingest/coverage.js";
import type { SqlClient } from "../src/store/configPaths.js";
import {
  type IngestItemRow,
  recordIngestItems,
  recordIngestRun,
} from "../src/store/ingestStore.js";
import { itemId, makeDigest } from "./podcast-fixtures.js";

vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

function neon(): SqlClient {
  const db = new PGlite();
  open.push(db);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

const FIRST_RUN = "2026-10-22T09:00:00.000Z";
const NOW = new Date("2026-10-30T09:00:00Z");

function row(n: number, status: "archived" | "unreadable"): IngestItemRow {
  return {
    item_id: itemId(n),
    canonical_url: `https://example.com/story-${n}`,
    source_id: "feed",
    title: `Story ${n}`,
    published_at: null,
    seen_at: "2026-10-25T09:00:00.000Z",
    status,
    method: status === "archived" ? "readability" : null,
    chars: status === "archived" ? 900 : 0,
    truncated: false,
    archive_key: status === "archived" ? `ingest/2026/10/key-${n}.json` : null,
  };
}

async function store(rows: IngestItemRow[]): Promise<SqlClient> {
  const sql = neon();
  await recordIngestItems(sql, rows);
  await recordIngestRun(sql, {
    run_id: FIRST_RUN,
    started_at: FIRST_RUN,
    finished_at: FIRST_RUN,
    window_from: FIRST_RUN,
    window_to: FIRST_RUN,
    sources_ok: 1,
    sources_failed: 0,
    fetched: rows.length,
    known: 0,
    archived: 0,
    unreadable: 0,
    errors: 0,
    deferred: 0,
    chars: 0,
    ms: 1,
    github_run_id: null,
  });
  return sql;
}

describe("ingest coverage", () => {
  it("counts a story as held only when its text is archived, and skips dailies from before the first run", async () => {
    const sql = await store([row(1, "archived"), row(2, "unreadable"), row(5, "archived")]);
    const before = makeDigest("2026-10-20", "2026-10-20T06:00:00.000Z", [{ n: 5 }]);
    const after = makeDigest("2026-10-25", "2026-10-25T06:00:00.000Z", [
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);

    const result = await measureCoverage({ sql, dailies: [after, before], now: NOW });

    expect(result.digests.map((d) => d.id)).toEqual(["2026-10-25"]);
    expect(result.digests[0]).toMatchObject({ aired: 3, held: 1 });
    expect(result.digests[0]?.missing.map((m) => m.id)).toEqual([itemId(2), itemId(3)]);
    expect(result.read_share).toBeCloseTo(2 / 3);
  });

  it("is not met before the shadow has run its days, however good the shares", async () => {
    const sql = await store([row(1, "archived"), row(2, "archived"), row(3, "archived")]);
    const daily = makeDigest("2026-10-25", "2026-10-25T06:00:00.000Z", [
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);

    const early = await measureCoverage({
      sql,
      dailies: [daily],
      now: new Date("2026-10-26T09:00:00Z"),
    });
    const later = await measureCoverage({ sql, dailies: [daily], now: NOW });

    expect(early).toMatchObject({ held_share: 1, read_share: 1, met: false });
    expect(later.met).toBe(true);
  });

  it("reads as nothing yet when ingest has never run", async () => {
    const result = await measureCoverage({ sql: neon(), dailies: [], now: NOW });

    expect(result).toMatchObject({ since: null, held_share: null, read_share: null, met: false });
  });
});
