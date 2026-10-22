import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./configPaths.js";
import {
  pruneVitals,
  readVitals,
  recordVitals,
  VITALS_WINDOW_DAYS,
  type VitalsReport,
} from "./vitalsStore.js";

// An in-process Postgres takes over 5 s to start when the three store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** The store's own SQL in an in-process Postgres (no network), with no table made in advance. */
function store(): { sql: SqlClient; rows: () => Promise<number> } {
  const db = new PGlite();
  open.push(db);
  return {
    sql: {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    },
    rows: async () =>
      Number(
        (await db.query<{ n: number }>("select count(*)::int as n from web_vitals")).rows[0]?.n,
      ),
  };
}

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");
const page = (lcp: number, device: VitalsReport["device"] = "mobile"): VitalsReport => ({
  page: "/d/[id]",
  device,
  connection: "4g",
  values: { lcp, cls: 0 },
});

describe("the field vitals store", () => {
  // The bugs it prevents: a p75 read over samples older than the window (a regression fixed a week
  // ago still alarming), phones and desktops read as one (a slow phone hidden by a fast desktop), a
  // report kept past the week the Privacy page promises when no new page load comes, a flood of
  // forged reports growing the table without bound, and the first report lost because no one had
  // created the table.
  it("reads a 7-day p75 per device, drops what fell out of the window, and caps each hour", async () => {
    const { sql, rows } = store();
    const old = NOW - VITALS_WINDOW_DAYS * 24 * HOUR - HOUR;
    expect(await recordVitals(sql, page(9000), old)).toBe(2);
    for (const [at, lcp] of [
      [NOW - 3 * HOUR, 1000],
      [NOW - 2 * HOUR, 4000],
      [NOW - HOUR, 3000],
      [NOW, 2000],
    ] as const) {
      await recordVitals(sql, page(lcp), at);
    }
    await recordVitals(sql, page(500, "desktop"), NOW);

    const read = await readVitals(sql, NOW);
    expect(read.filter((each) => each.metric === "lcp")).toEqual(
      expect.arrayContaining([
        { metric: "lcp", device: "mobile", samples: 4, p75: 3000 },
        { metric: "lcp", device: "desktop", samples: 1, p75: 500 },
      ]),
    );
    // The sample from before the window was deleted by the next insert, not only left unread.
    expect(await rows()).toBe(10);
    // Read days later, with no insert since, only the last 1.5 hours of samples are still inside,
    // and health's prune deletes the rest.
    const daysLater = NOW + VITALS_WINDOW_DAYS * 24 * HOUR - 1.5 * HOUR;
    const later = await readVitals(sql, daysLater);
    await pruneVitals(sql, daysLater);
    expect(later.find((each) => each.metric === "lcp" && each.device === "mobile")).toEqual({
      metric: "lcp",
      device: "mobile",
      samples: 2,
      p75: 3000,
    });
    // Only the six rows of the last 1.5 hours are kept.
    expect(await rows()).toBe(6);

    // The last hour holds 4 rows: a page of 2 more would pass a cap of 5, so it is refused whole;
    // an hour later there is room again.
    expect(await recordVitals(sql, page(1500), NOW + 1, 5)).toBe(0);
    expect(await recordVitals(sql, page(1500), NOW + 2 * HOUR, 5)).toBe(2);
  });
});
