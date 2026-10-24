import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./configPaths.js";
import {
  activeShareLink,
  createShareLink,
  revokeShareLinks,
  startSharedPlay,
} from "./shareStore.js";

// An in-process Postgres takes over 5 s to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** The store's own SQL in an in-process Postgres (no network), with no table made in advance. */
function store(): SqlClient {
  const db = new PGlite();
  open.push(db);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-24T12:00:00Z");
const LIMITS = { playsPerLink: 3, monthlyBytes: 100 };
const segments = [{ url: "https://s.public.blob.vercel-storage.com/a.mp3", duration_ms: 1000 }];

async function link(sql: SqlClient, id: string, itemId: string, bytes = 10, now = NOW) {
  const expiresAt = now + 30 * DAY;
  return createShareLink(sql, { id, itemId, now, expiresAt, bytes, segments, source: "v1" });
}

describe("the share store's play gate", () => {
  // The bugs it prevents: a stranger playing past the link's cap or past the month's Blob budget
  // (Hobby locks the store for 30 days past its transfer, which stops the owner's own listening),
  // and an expired or stopped link that still plays because only the page checked it.
  it("refuses an expired, a revoked, an over-cap and an over-budget link, and counts what it grants", async () => {
    const sql = store();
    await link(sql, "a", "2026-10-07");
    for (let play = 0; play < LIMITS.playsPerLink; play += 1) {
      expect(await startSharedPlay(sql, "a", NOW, LIMITS)).toMatchObject({ granted: true });
    }
    expect(await startSharedPlay(sql, "a", NOW, LIMITS)).toEqual({
      granted: false,
      reason: "link_limit",
    });

    // 30 of the month's 100 bytes are spent: a 71-byte item would pass the budget, so it is refused.
    await link(sql, "big", "ep-20261007-1930", 71);
    expect(await startSharedPlay(sql, "big", NOW, LIMITS)).toEqual({
      granted: false,
      reason: "month_limit",
    });
    // The next month starts empty.
    const nextMonth = Date.parse("2026-11-01T00:00:01Z");
    expect(await startSharedPlay(sql, "big", nextMonth, LIMITS)).toMatchObject({ granted: true });

    await link(sql, "old", "2026-10-05");
    expect(await startSharedPlay(sql, "old", NOW + 31 * DAY, LIMITS)).toEqual({
      granted: false,
      reason: "gone",
    });

    await link(sql, "stopped", "2026-10-04-weekly");
    expect(await revokeShareLinks(sql, "2026-10-04-weekly", NOW)).toBe(1);
    expect(await startSharedPlay(sql, "stopped", NOW, LIMITS)).toEqual({
      granted: false,
      reason: "gone",
    });
    expect(await startSharedPlay(sql, "made-up", NOW, LIMITS)).toEqual({
      granted: false,
      reason: "not_found",
    });
  });

  // The bug it prevents: two links for one item, so Stop sharing stops one and the other keeps
  // playing; and an expired link that blocks the item from ever being shared again.
  it("keeps one working link per item and lets an expired one be replaced", async () => {
    const sql = store();
    const first = await link(sql, "one", "2026-10-07");
    expect((await link(sql, "two", "2026-10-07")).id).toBe(first.id);
    const later = NOW + 31 * DAY;
    expect(await activeShareLink(sql, "2026-10-07", later)).toBeNull();
    expect((await link(sql, "three", "2026-10-07", 10, later)).id).toBe("three");
  });
});
