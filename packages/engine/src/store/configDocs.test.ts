import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../context.js";
import {
  hydrateConfig,
  readsConfigAtStart,
  type SqlClient,
  seedConfigDocuments,
} from "./configDocs.js";

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeStore(rows: { path: string; content: string }[]): SqlClient {
  return { query: async () => rows.map((row) => ({ ...row, version: 1 })) };
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

describe("hydrateConfig", () => {
  // The bug: the engine writes whatever a row names. A stray or hostile row could overwrite `.env`,
  // a digest, or a file outside the checkout, and a row that is not JSON would break every loader
  // for the run. Only the listed config files, and only valid JSON, may replace a committed file.
  it("writes only listed config files that hold JSON, and keeps files the store has no row for", async () => {
    const root = await mkdtemp(join(tmpdir(), "config-store-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config/schedule.json"), '{"hour":7}\n');
    await writeFile(join(root, "config/preferences.json"), '{"weights":{}}\n');

    const changed = await hydrateConfig(
      root,
      fakeStore([
        { path: "config/topics.json", content: '{"topics":[]}\n' },
        { path: "config/schedule.json", content: "{not json" },
        { path: ".env", content: '{"stolen":true}' },
        { path: `../${basename(root)}-outside.json`, content: "{}" },
        { path: "Digests/2026/x.json", content: "{}" },
      ]),
      quiet,
    );

    expect(changed).toEqual(["config/topics.json"]);
    expect(await readFile(join(root, "config/topics.json"), "utf8")).toBe('{"topics":[]}\n');
    expect(await readFile(join(root, "config/schedule.json"), "utf8")).toBe('{"hour":7}\n');
    expect(await readFile(join(root, "config/preferences.json"), "utf8")).toBe('{"weights":{}}\n');
    expect(await exists(join(root, ".env"))).toBe(false);
    expect(await exists(join(root, `../${basename(root)}-outside.json`))).toBe(false);
    expect(await exists(join(root, "Digests/2026/x.json"))).toBe(false);
  });
});

describe("readsConfigAtStart", () => {
  // The bug: run.yml runs each stage as its own process. If the gate stage is missed, a run builds
  // from the stale committed files without a word; if a later stage copies again, one run mixes two
  // versions of the topics (an edit landing between fetch and write).
  it.each([
    [["--stage", "gate", "--json"], true],
    [["--stage=gate"], true],
    [["--json", "--stage", "fetch"], false],
    [["--stage=write", "--feedback", "x"], false],
    [["--delete", "2026-10-22"], true],
    // The bug: the failure record of a run, made after the gate copied the store, rewrote the gate's
    // note (removed it, in a step with no store settings), so the guard refused the record.
    [["--record-failed", "--json"], false],
    [[], true],
  ])("run %j -> %s", (argv, expected) => {
    expect(readsConfigAtStart("run", argv)).toBe(expected);
  });
});

describe("readsConfigAtStart for ingest", () => {
  // The bug it prevents: ingest reading the committed sources, which lack every source the owner
  // added from the app since the last run.
  it("copies the store before ingest reads the sources", () => {
    expect(readsConfigAtStart("ingest", [])).toBe(true);
  });
});

/** A config_documents table in memory that answers the statements seed sends. */
function memoryTable(rows: { path: string; content: string; version: number }[]): SqlClient {
  return {
    query: async (text, params = []) => {
      if (text.startsWith("create table")) return [];
      if (text.startsWith("select path, content, version")) return rows.map((row) => ({ ...row }));
      const [path, content] = params as [string, string];
      const row = rows.find((entry) => entry.path === path);
      if (!row) {
        rows.push({ path, content, version: 1 });
        return [{ path }];
      }
      if (!text.includes("do update") || row.content === content) return [];
      Object.assign(row, { content, version: row.version + 1 });
      return [{ path }];
    },
  };
}

describe("seedConfigDocuments", () => {
  // The bug: the owner seeded production days before switching on, and seed never replaces a row, so
  // a config change committed in between would greet the switch with the old settings. --replace
  // refreshes the rows that differ from the committed files; plain seed still never touches a row.
  it("keeps a stored row, and with replace rewrites only the rows that differ", async () => {
    const root = await mkdtemp(join(tmpdir(), "config-seed-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config/schedule.json"), '{"hour":9}\n');
    await writeFile(join(root, "config/topics.json"), '{"topics":[]}\n');
    const rows = [
      { path: "config/schedule.json", content: '{"hour":7}\n', version: 1 },
      { path: "config/topics.json", content: '{"topics":[]}\n', version: 1 },
    ];
    const sql = memoryTable(rows);

    expect(await seedConfigDocuments(root, sql)).toEqual([]);
    expect(rows[0]?.content).toBe('{"hour":7}\n');

    expect(await seedConfigDocuments(root, sql, { replace: true, dryRun: true })).toEqual([
      "config/schedule.json",
    ]);
    expect(rows[0]?.content).toBe('{"hour":7}\n');

    expect(await seedConfigDocuments(root, sql, { replace: true })).toEqual([
      "config/schedule.json",
    ]);
    expect(rows).toEqual([
      { path: "config/schedule.json", content: '{"hour":9}\n', version: 2 },
      { path: "config/topics.json", content: '{"topics":[]}\n', version: 1 },
    ]);
  });
});
