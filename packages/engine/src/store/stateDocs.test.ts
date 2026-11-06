import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SqlClient } from "./configPaths.js";
import {
  isStatePath,
  pullState,
  pushState,
  STATE_SCHEMA_SQL,
  StateConflictError,
  seedState,
} from "./stateDocs.js";

// An in-process Postgres takes a while to start when several store files start theirs at once.
vi.setConfig({ testTimeout: 30_000 });
const open: PGlite[] = [];
afterAll(async () => {
  await Promise.all(open.map((db) => db.close()));
});

/** The statements use `on conflict` and `returning`: a fake cannot check them. */
async function realStore(): Promise<SqlClient> {
  const db = new PGlite();
  open.push(db);
  await db.query(STATE_SCHEMA_SQL);
  return {
    query: async (text, params) =>
      (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
  };
}

async function checkout(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "state-store-"));
  await mkdir(join(root, "state"), { recursive: true });
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), text);
  return root;
}

const text = (root: string, path: string) => readFile(join(root, path), "utf8");
const TIMINGS = "state/podcast-timings.json";
const timings = (...ids: string[]) =>
  `${JSON.stringify({ version: 1, runs: ids.map((id) => ({ at: `2026-11-06T0${ids.indexOf(id)}:00:00Z`, run_id: id })) }, null, 2)}\n`;

describe("isStatePath", () => {
  // The bug: a row's path is written to disk. Only plain state files may be named, never `.env`,
  // a digest, a path above the checkout, or the config store's own suggested sources.
  it("accepts state files only", () => {
    expect(isStatePath("state/seen.json")).toBe(true);
    expect(isStatePath(TIMINGS)).toBe(true);
    for (const path of [
      ".env",
      "Digests/2026/x.json",
      "state/../.env",
      "state/sub/x.json",
      "state/source-candidates.json",
      "state/seen.txt",
    ]) {
      expect(isStatePath(path)).toBe(false);
    }
  });
});

describe("pullState and pushState", () => {
  // The bug: a job that writes a state file the next job never sees repeats work (a story, a
  // spend). A pushed change must be exactly what the next pull gives, and a file nobody touched
  // must not be written back (it would bump the version and make every other job merge).
  it("round-trips: a pushed change is what the next job pulls, and an untouched file is not written", async () => {
    const sql = await realStore();
    const first = await checkout({ "state/seen.json": '{"a":1}\n', "state/last-run.json": "{}\n" });
    expect(await seedState(first, sql)).toEqual(["state/last-run.json", "state/seen.json"]);

    await pullState(first, sql);
    await writeFile(join(first, "state/seen.json"), '{"a":2}\n');
    expect(await pushState(first, sql)).toEqual({ written: ["state/seen.json"], merged: [] });

    const second = await checkout();
    expect(await pullState(second, sql)).toEqual(["state/last-run.json", "state/seen.json"]);
    expect(await text(second, "state/seen.json")).toBe('{"a":2}\n');
    expect(await pushState(second, sql)).toEqual({ written: [], merged: [] });
  });

  it("never writes a row for a path outside state/*.json, and seed keeps rows that exist", async () => {
    const sql = await realStore();
    await sql.query("insert into state_documents (path, content) values ($1, $2), ($3, $4)", [
      ".env",
      "SECRET=1",
      "state/seen.json",
      "stored\n",
    ]);
    const root = await checkout({ "state/seen.json": "local\n", ".env": "keep" });
    expect(await seedState(root, sql)).toEqual([]);
    expect(await pullState(root, sql)).toEqual(["state/seen.json"]);
    expect(await text(root, ".env")).toBe("keep");
    expect(await text(root, "state/seen.json")).toBe("stored\n");
  });

  // The bug (2026-10-27, now in the database): a digest run and an episode run both add entries and
  // one overwrites the other, losing the episode's entry.
  it("merges a file another job wrote meanwhile, and keeps both jobs' runs", async () => {
    const sql = await realStore();
    const a = await checkout({ [TIMINGS]: timings("base") });
    expect(await seedState(a, sql)).toEqual([TIMINGS]);
    const b = await checkout();
    await pullState(a, sql);
    await pullState(b, sql);

    await writeFile(join(a, TIMINGS), timings("base", "digest"));
    await writeFile(join(b, TIMINGS), timings("base", "episode"));
    await pushState(a, sql);
    const result = await pushState(b, sql);

    expect(result.merged).toEqual([TIMINGS]);
    const [row] = await sql.query("select content from state_documents");
    const ids = (JSON.parse(String(row?.content)) as { runs: { run_id: string }[] }).runs.map(
      (run) => run.run_id,
    );
    expect(ids.sort()).toEqual(["base", "digest", "episode"]);
    // The checkout matches the store, so a later command in the job reads the merged file.
    expect(await text(b, TIMINGS)).toBe(String(row?.content));
  });

  // The bug: seen.json has no merge rule. Overwriting it would forget the other job's stories and
  // repeat them in the next digest, so the second push must stop and leave the first one's row.
  it("refuses a file with no merge rule that another job wrote meanwhile", async () => {
    const sql = await realStore();
    const a = await checkout({ "state/seen.json": '{"n":0}\n' });
    await seedState(a, sql);
    const b = await checkout();
    await pullState(a, sql);
    await pullState(b, sql);

    await writeFile(join(a, "state/seen.json"), '{"n":"a"}\n');
    await writeFile(join(b, "state/seen.json"), '{"n":"b"}\n');
    await pushState(a, sql);
    await expect(pushState(b, sql)).rejects.toBeInstanceOf(StateConflictError);

    const [row] = await sql.query("select content from state_documents");
    expect(row?.content).toBe('{"n":"a"}\n');
  });

  // The bug: one refused file must not cost the run its other state. If seen.json conflicts, the
  // costs this run billed still have to be recorded, and the run still ends red.
  it("writes the other files when one is refused, then fails", async () => {
    const sql = await realStore();
    const a = await checkout({ "state/seen.json": "0\n", [TIMINGS]: timings("base") });
    await seedState(a, sql);
    const b = await checkout();
    await pullState(a, sql);
    await pullState(b, sql);
    await writeFile(join(a, "state/seen.json"), "a\n");
    await pushState(a, sql);

    await writeFile(join(b, "state/seen.json"), "b\n");
    await writeFile(join(b, TIMINGS), timings("base", "mine"));
    await expect(pushState(b, sql)).rejects.toBeInstanceOf(StateConflictError);

    const [row] = await sql.query("select content from state_documents where path = $1", [TIMINGS]);
    expect(String(row?.content)).toContain("mine");
    // The baseline moved for the file that landed and stayed for the refused one, so a retry
    // does not mistake the landed file for an edit.
    const baseline = JSON.parse(await text(b, ".cache/state-pulled.json")) as Record<
      string,
      { version: number }
    >;
    expect(baseline[TIMINGS]?.version).toBeGreaterThan(1);
    expect(baseline["state/seen.json"]?.version).toBe(1);
  });

  // The bug: usage.json merges as "the row plus what this job added since the pull". With no pull
  // record the ancestor is unknown, and guessing it double-counts the Speechify quota.
  it("refuses to push without a pull record", async () => {
    const sql = await realStore();
    const root = await checkout({ "state/seen.json": "x\n" });
    await seedState(root, sql);
    await expect(pushState(root, sql)).rejects.toThrow(/state pull/);
  });

  // The bug: a row dropped since the pull (reseeded store) made a file with no merge rule fail
  // with a conflict, although this job's file is then the only copy and should go back in.
  it("puts a file back when its row was removed since the pull", async () => {
    const sql = await realStore();
    const root = await checkout({ "state/seen.json": "0\n" });
    await seedState(root, sql);
    await pullState(root, sql);
    await sql.query("delete from state_documents");
    await writeFile(join(root, "state/seen.json"), "1\n");
    expect(await pushState(root, sql)).toEqual({ written: ["state/seen.json"], merged: [] });
  });
});
