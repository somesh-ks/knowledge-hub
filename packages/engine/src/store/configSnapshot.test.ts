import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CONFIG_SCHEMA_SQL } from "./configDocs.js";
import type { SqlClient } from "./configPaths.js";
import {
  createSqlSnapshotStore,
  parseSnapshot,
  restoreDocuments,
  SNAPSHOTS_KEEP,
  type SnapshotStore,
  snapshotKey,
  snapshotKeysNewestFirst,
  takeSnapshot,
} from "./configSnapshot.js";

function fakeSql(rows: { path: string; content: string }[]): SqlClient {
  return { query: async () => rows.map((row) => ({ ...row, version: 3 })) };
}

// An in-process Postgres takes a while to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });
const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** The restore statement runs on a real Postgres: a fake cannot check `on conflict`. */
async function realStore(): Promise<SqlClient> {
  const db = new PGlite();
  open.push(db);
  await db.query(CONFIG_SCHEMA_SQL);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

function fakeStore(
  keys: string[],
): SnapshotStore & { objects: Map<string, string>; dropped: string[] } {
  const objects = new Map<string, string>(keys.map((key) => [key, "{}"]));
  const dropped: string[] = [];
  return {
    objects,
    dropped,
    async put(key, text) {
      objects.set(key, text);
    },
    async read(key) {
      return objects.get(key) ?? null;
    },
    async keys() {
      return [...objects.keys()];
    },
    async del(names) {
      for (const name of names) {
        objects.delete(name);
        dropped.push(name);
      }
    },
  };
}

describe("takeSnapshot", () => {
  // The bug: a weekly job that snapshots an emptied store (a wrong DATABASE_URL, a dropped table)
  // would write an empty copy and, after eight weeks, push every good one out of the window.
  it("refuses an empty store and writes nothing", async () => {
    const store = fakeStore(["config-snapshots/2026-10-25.json"]);
    await expect(
      takeSnapshot({ sql: fakeSql([]), store, now: new Date("2026-11-01T04:00:00Z") }),
    ).rejects.toThrow(/no documents/);
    expect([...store.objects.keys()]).toEqual(["config-snapshots/2026-10-25.json"]);
  });

  // The bug: pruning by "everything but today" or by a loose prefix could delete a neighbour's
  // object or the only good copy; it must keep the newest few snapshots and touch nothing else.
  it("keeps the newest snapshots and never deletes a key that is not a snapshot", async () => {
    const old = Array.from({ length: SNAPSHOTS_KEEP + 2 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return `config-snapshots/2026-09-${day}.json`;
    });
    const store = fakeStore([...old, "config-snapshots/notes.txt"]);
    const result = await takeSnapshot({
      sql: fakeSql([{ path: "config/topics.json", content: "{}" }]),
      store,
      now: new Date("2026-11-01T04:00:00Z"),
    });
    expect(result.key).toBe(snapshotKey(new Date("2026-11-01T00:00:00Z")));
    expect(store.dropped.sort()).toEqual(old.slice(0, 3));
    expect(store.objects.has("config-snapshots/notes.txt")).toBe(true);
    expect(store.objects.has(result.key)).toBe(true);
  });
});

describe("createSqlSnapshotStore", () => {
  // The bug: the weekly job now writes into Neon, and its SQL (an upsert on the day's key, a delete
  // by key list) runs only against a real Postgres. A rerun the same day must replace, not fail or
  // add a row, and the prune must drop the old keys and nothing else.
  it("replaces the day's snapshot on a rerun, reads it back and prunes by key", async () => {
    const sql = await realStore();
    await sql.query("insert into config_documents (path, content) values ($1, $2)", [
      "config/topics.json",
      '{"a":1}',
    ]);
    const store = createSqlSnapshotStore(sql);
    await takeSnapshot({ sql, store, now: new Date("2026-10-25T04:00:00Z"), keep: 2 });
    await takeSnapshot({ sql, store, now: new Date("2026-11-01T04:00:00Z"), keep: 2 });
    await sql.query("update config_documents set content = $1", ['{"a":2}']);
    await takeSnapshot({ sql, store, now: new Date("2026-11-01T05:00:00Z"), keep: 2 });
    await takeSnapshot({ sql, store, now: new Date("2026-11-08T04:00:00Z"), keep: 2 });
    expect((await store.keys()).sort()).toEqual([
      "config-snapshots/2026-11-01.json",
      "config-snapshots/2026-11-08.json",
    ]);
    const kept = parseSnapshot((await store.read("config-snapshots/2026-11-01.json")) ?? "");
    expect(kept.documents.map((d) => d.content)).toEqual(['{"a":2}']);
    expect(await store.read("config-snapshots/2026-01-01.json")).toBeNull();
  });
});

describe("snapshotKeysNewestFirst", () => {
  // The bug: `restore --latest` took the last key by name, and "notes.txt" sorts after every date, so
  // a stray object in the store was chosen over every good snapshot.
  it("puts the newest dated snapshot first and ignores other objects", () => {
    expect(
      snapshotKeysNewestFirst([
        "config-snapshots/2026-10-25.json",
        "config-snapshots/notes.txt",
        "config-snapshots/2026-11-01.json",
      ]),
    ).toEqual(["config-snapshots/2026-11-01.json", "config-snapshots/2026-10-25.json"]);
  });
});

describe("restoreDocuments", () => {
  // The bug it prevents: a restore that bumps every row, or skips a changed one, makes the app think
  // nothing changed (or everything did), and a stale page then overwrites the restored config.
  it("inserts missing rows, updates changed ones with a new version, and leaves equal ones alone", async () => {
    const sql = await realStore();
    await sql.query("insert into config_documents (path, content) values ($1, $2), ($3, $4)", [
      "config/topics.json",
      '{"a":1}',
      "config/schedule.json",
      '{"hour":7}',
    ]);
    const written = await restoreDocuments(sql, {
      version: 1,
      taken_at: "2026-11-01T04:00:00.000Z",
      documents: [
        { path: "config/topics.json", content: '{"a":2}', version: 1 },
        { path: "config/schedule.json", content: '{"hour":7}', version: 1 },
        { path: "config/queries.json", content: "{}", version: 1 },
      ],
    });
    expect(written.sort()).toEqual(["config/queries.json", "config/topics.json"]);
    const rows = await sql.query(
      "select path, content, version from config_documents order by path",
    );
    expect(rows).toEqual([
      { path: "config/queries.json", content: "{}", version: 1 },
      { path: "config/schedule.json", content: '{"hour":7}', version: 1 },
      { path: "config/topics.json", content: '{"a":2}', version: 2 },
    ]);
  });
});

describe("parseSnapshot", () => {
  // The bug: a snapshot file is plain text anyone can edit; a row named `.env` or `Digests/..` must
  // never reach the table, so the whole file is refused.
  it("refuses a snapshot that names a path outside the config documents", async () => {
    const text = JSON.stringify({
      version: 1,
      taken_at: "2026-11-01T04:00:00.000Z",
      documents: [
        { path: "config/topics.json", content: "{}", version: 1 },
        { path: ".env", content: "x", version: 1 },
      ],
    });
    expect(() => parseSnapshot(text)).toThrow(/not config/);
  });

  // The bug: one INSERT ... ON CONFLICT cannot touch a row twice, so a path listed twice would fail
  // the whole restore at the database; refusing the file says why.
  it("refuses a snapshot that lists a path twice", () => {
    const doc = { path: "config/topics.json", content: "{}", version: 1 };
    expect(() => parseSnapshot(JSON.stringify({ version: 1, documents: [doc, doc] }))).toThrow(
      /twice/,
    );
  });
});
