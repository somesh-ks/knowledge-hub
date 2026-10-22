import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./configPaths.js";
import {
  type ClientFault,
  FAULTS_WINDOW_DAYS,
  pruneClientFaults,
  readClientFaults,
  recordClientFault,
} from "./faultsStore.js";

// An in-process Postgres takes over 5 s to start when the three store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });

const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-22T12:00:00Z");
const fault: ClientFault = {
  kind: "csp",
  page: "/settings",
  message: "",
  directive: "script-src-elem",
  blocked: "https://evil.example",
  source: "",
  build: "0123456789ab",
};

describe("the client faults store", () => {
  // Hobby kept faults for an hour (D158). The store must create its table on the first report,
  // keep no more than the week the Privacy page promises (on insert and on health's daily read),
  // cut a flood at the hour's cap, and count the last day apart from the week.
  it("creates itself, groups the week, prunes what fell out and caps each hour", async () => {
    const db = new PGlite();
    open.push(db);
    const sql: SqlClient = {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    };
    const old = NOW - FAULTS_WINDOW_DAYS * 24 * HOUR - HOUR;
    expect(await recordClientFault(sql, fault, old)).toBe(1);
    expect(await recordClientFault(sql, fault, NOW - 2 * 24 * HOUR)).toBe(1);
    expect(await recordClientFault(sql, fault, NOW, 1)).toBe(1);
    expect(await recordClientFault(sql, fault, NOW, 1)).toBe(0);
    // A full hour of client reports (anyone can send one) never crowds out a server fault.
    const server: ClientFault = { ...fault, kind: "server", directive: "", blocked: "" };
    expect(await recordClientFault(sql, server, NOW, 1)).toBe(1);
    await db.query("delete from client_faults where kind = 'server'");
    expect(await readClientFaults(sql, NOW)).toEqual([{ ...fault, total: 2, day: 1 }]);
    await pruneClientFaults(sql, NOW + 6 * 24 * HOUR);
    const left = await db.query<{ n: number }>("select count(*)::int as n from client_faults");
    expect(left.rows[0]?.n).toBe(1);
  });
});
