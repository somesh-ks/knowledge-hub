import { describe, expect, it } from "vitest";
import type { SqlClient } from "./configPaths.js";
import {
  parseSnapshot,
  SNAPSHOTS_KEEP,
  type SnapshotStore,
  snapshotKey,
  snapshotKeysNewestFirst,
  takeSnapshot,
} from "./configSnapshot.js";

function fakeSql(rows: { path: string; content: string }[]): SqlClient & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async query(text, params) {
      if (text.startsWith("insert into config_documents")) {
        writes.push(String(params?.[0]));
        return [{ path: params?.[0] }];
      }
      return rows.map((row) => ({ ...row, version: 3 }));
    },
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
});
