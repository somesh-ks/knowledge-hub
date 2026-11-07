import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  stateScopeFor,
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

  // The bug: a row dropped since the pull (a reset store) put back at its old version lets another
  // checkout that pulled the same version overwrite it without a conflict. The push refuses and the
  // owner pulls and seeds again.
  it("refuses to put a file back when its row was removed since the pull", async () => {
    const sql = await realStore();
    const root = await checkout({ "state/seen.json": "0\n" });
    await seedState(root, sql);
    await pullState(root, sql);
    await sql.query("delete from state_documents");
    await writeFile(join(root, "state/seen.json"), "1\n");
    await expect(pushState(root, sql)).rejects.toBeInstanceOf(StateConflictError);
    expect(await sql.query("select path from state_documents")).toEqual([]);
  });

  // The bug: two checkouts pulled before usage.json had a row and both hold the same local count.
  // The first push inserts it; merging the second one with no ancestor would add that shared count
  // again and inflate the Speechify quota.
  it("refuses to merge usage.json when the pull saw no row to take as the ancestor", async () => {
    const sql = await realStore();
    const usage = `${JSON.stringify({ speechify: { month: "2026-11", characters: 100 } })}\n`;
    const a = await checkout({ "state/usage.json": usage });
    const b = await checkout({ "state/usage.json": usage });
    await pullState(a, sql);
    await pullState(b, sql);
    await pushState(a, sql);
    await expect(pushState(b, sql)).rejects.toBeInstanceOf(StateConflictError);
    const [row] = await sql.query("select content from state_documents");
    expect(row?.content).toBe(usage);
  });

  // The bug: a pull whose row query fails must not leave a record that lets a push go ahead and
  // treat every state file as new.
  it("leaves no pull record when the pull fails, so a push refuses", async () => {
    const sql = await realStore();
    const root = await checkout({ "state/seen.json": "x\n" });
    await pullState(root, sql);
    const broken: SqlClient = {
      query: async () => {
        throw new Error("network down");
      },
    };
    await expect(pullState(root, broken)).rejects.toThrow("network down");
    await expect(pushState(root, sql)).rejects.toThrow(/state pull/);
  });
});

describe("the audio job's restricted login (D381)", () => {
  /** The grants in the runbook are what the owner runs; the test runs the same text. */
  async function runbookSql(): Promise<string> {
    const runbook = await readFile(
      fileURLToPath(new URL("../../../../docs/runbook.md", import.meta.url)),
      "utf8",
    );
    const block = [...runbook.matchAll(/```sql\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? "")
      .find((sql) => sql.includes("audio_state"));
    if (block === undefined) throw new Error("docs/runbook.md has no sql block for audio_state");
    // The owner creates the table from this block, so it must be the table the engine writes.
    expect(block).toContain(STATE_SCHEMA_SQL);
    return block.replace("<password>", "test-password");
  }

  /** Two clients on one database: the owner seeds, `audio_state` is the login the audio job gets. */
  async function ownerAndAudio(): Promise<{ owner: SqlClient; audio: SqlClient }> {
    const db = new PGlite();
    open.push(db);
    await db.exec(await runbookSql());
    const owner: SqlClient = {
      query: async (text, params) =>
        (await db.query<Record<string, unknown>>(text, params ?? [])).rows,
    };
    const audio: SqlClient = {
      query: async (text, params) => {
        await db.exec("set role audio_state");
        try {
          return (await db.query<Record<string, unknown>>(text, params ?? [])).rows;
        } finally {
          await db.exec("reset role");
        }
      },
    };
    return { owner, audio };
  }

  const COSTS = "state/costs-2026-11.json";

  // The bug it prevents: the audio job runs a third-party voice API, so its login must not read or
  // change the digest's seen list or judgments even if the engine had a bug that tried to.
  it("lets the audio login read and write its own rows and no other", async () => {
    const { owner, audio } = await ownerAndAudio();
    await owner.query("insert into state_documents (path, content) values ($1, 'a'), ($2, 'b')", [
      "state/seen.json",
      COSTS,
    ]);
    expect((await audio.query("select path from state_documents")).map((r) => r.path)).toEqual([
      COSTS,
    ]);
    await expect(
      audio.query("insert into state_documents (path, content) values ('state/seen.json', 'x')"),
    ).rejects.toThrow();
    expect(
      await audio.query(
        "update state_documents set content = 'x' where path = 'state/seen.json' returning path",
      ),
    ).toEqual([]);
    await expect(audio.query("delete from state_documents")).rejects.toThrow();
    expect(
      (await owner.query("select content from state_documents where path = 'state/seen.json'"))[0]
        ?.content,
    ).toBe("a");
  });

  // The bug it prevents: the pushes of other jobs' files from an audio checkout that holds the whole
  // state/ directory (it is in git until step 5) would be refused by the login, failing the job.
  it("pulls and pushes only the audio files, leaving the rest of state/ alone", async () => {
    const { owner, audio } = await ownerAndAudio();
    const scope = stateScopeFor("publish");
    expect(scope?.(COSTS)).toBe(true);
    expect(scope?.("state/usage.json")).toBe(true);
    expect(scope?.("state/seen.json")).toBe(false);
    expect(stateScopeFor("run")).toBeUndefined();

    await owner.query("insert into state_documents (path, content) values ($1, $2)", [
      COSTS,
      '{"v":1}\n',
    ]);
    const root = await checkout({ "state/seen.json": "local\n" });
    expect(await pullState(root, audio, scope)).toEqual([COSTS]);
    await writeFile(join(root, COSTS), '{"v":2}\n');
    await writeFile(join(root, "state/usage.json"), '{"u":1}\n');
    expect(await pushState(root, audio, undefined, scope)).toEqual({
      written: [COSTS, "state/usage.json"],
      merged: [],
    });
    const rows = await owner.query("select path from state_documents order by path");
    expect(rows.map((r) => r.path)).toEqual([COSTS, "state/usage.json"]);
    expect(await text(root, "state/seen.json")).toBe("local\n");
  });
});
