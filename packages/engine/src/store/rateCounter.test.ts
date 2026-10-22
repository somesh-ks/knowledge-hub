import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import type { SqlClient } from "./configPaths.js";
import { RATE_LIMIT_SCHEMA_SQL, takeSharedSlot } from "./rateCounter.js";

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** The counter's own SQL, run in an in-process Postgres (no network), so its window logic is tested. */
async function counter(): Promise<SqlClient> {
  const db = new PGlite();
  open.push(db);
  await db.query(RATE_LIMIT_SCHEMA_SQL);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

describe("takeSharedSlot", () => {
  // The bug: the caps of the open paid routes were counted per instance, so each cold start handed
  // out a fresh minute. The shared count must hold a full minute closed, refusals included, open
  // again only in the next minute, keep buckets apart, and never let an instance whose clock runs
  // behind reset a full window back to an empty one.
  it("holds a full minute closed, against a late clock too, and opens again in the next", async () => {
    const sql = await counter();
    const minute = 29_000_000 * 60_000;
    const take = (bucket: string, at: number) => takeSharedSlot(sql, bucket, 2, at);

    expect(await take("a", minute)).toBe(true);
    expect(await take("a", minute + 30_000)).toBe(true);
    expect(await take("a", minute - 500)).toBe(false);
    expect(await take("a", minute + 59_999)).toBe(false);
    expect(await take("b", minute + 59_999)).toBe(true);
    expect(await take("a", minute + 60_000)).toBe(true);
  });
});
