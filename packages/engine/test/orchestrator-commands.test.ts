import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeEvalCommand } from "../src/commands/eval.js";
import { extractIds, makeExtractCommand } from "../src/commands/extract.js";
import { run as learn, makeLearn } from "../src/commands/learn.js";
import { makeRunCommand } from "../src/commands/run.js";
import { run as status } from "../src/commands/status.js";
import type { ExtractedText } from "../src/extract/extractText.js";
import { writePool } from "../src/fetch/pool.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  digestFile,
  head,
  instantiate,
  json,
  lastRunFile,
  makeWorld,
  poolFile,
  sourceItems,
  sourcesFile,
  type TestRepo,
} from "./orchestrator-fixtures.js";
import { FIXTURE_CONFIG } from "./score-factories.js";

let scratch: string;
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "singularity-cmd-"));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
});

async function put(rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(scratch, rel)), { recursive: true });
  await writeFile(join(scratch, rel), content, "utf8");
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: await fn(), stderr: chunks.join("") };
  } finally {
    process.stderr.write = original;
  }
}

// --- status ------------------------------------------------------------------------------------

describe("singularity status", () => {
  async function seedRepoFiles(): Promise<void> {
    await put("config/sources.json", json(sourcesFile()));
    await put(
      "state/last-run.json",
      lastRunFile({
        regular: {
          at: "2026-10-05T05:30:00Z",
          outcome: "published",
          digest_id: "2026-10-05",
          items: 7,
        },
        weekly: {
          at: "2026-10-04T06:00:00Z",
          outcome: "published",
          digest_id: "2026-10-04-weekly",
          items: 12,
        },
        on_demand: { at: "2026-10-03T14:10:00Z", outcome: "nothing", items: 0 },
        last_fetch_at: "2026-10-05T05:28:00Z",
      }),
    );
    await put(
      "state/usage.json",
      json({ version: 1, speechify: { month: "2026-10", characters: 12_345 } }),
    );
    await put(
      "state/source-health.json",
      json({
        version: 1,
        sources: {
          "blog-b": { failures: 5 },
          "blog-a": { failures: 2, last_ok: "2026-10-04T05:00:00Z" },
        },
      }),
    );
    await put("Digests/2026/10/2026-10-05.md", digestFile("2026-10-05"));
    await put(
      "Digests/2026/10/2026-10-03.md",
      digestFile("2026-10-03", {
        url: "https://example.public.blob.vercel-storage.com/audio/2026-10-03.mp3",
        duration_ms: 200_000,
      }),
    );
  }

  async function report(args: string[] = [], jsonOutput = true) {
    const { ctx } = makeContext(scratch, { json: jsonOutput });
    const { result, stdout } = await captureStdout(() => status(args, ctx));
    return { code: result, stdout };
  }

  it("has the stable shape the skill and scripts read", async () => {
    await seedRepoFiles();
    const { code, stdout } = await report();
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      version: 1,
      now: "2026-10-07T05:13:00.000Z",
      timezone: "Europe/Stockholm",
      today: "2026-10-07",
      last_run: {
        regular: {
          at: "2026-10-05T05:30:00Z",
          outcome: "published",
          digest_id: "2026-10-05",
          items: 7,
        },
        weekly: {
          at: "2026-10-04T06:00:00Z",
          outcome: "published",
          digest_id: "2026-10-04-weekly",
          items: 12,
        },
        on_demand: { at: "2026-10-03T14:10:00Z", outcome: "nothing", digest_id: null, items: 0 },
      },
      last_fetch_at: "2026-10-05T05:28:00Z",
      next_regular_due: "2026-10-07",
      due_now: true,
      due_reason: "last regular digest was 2026-10-05, 2 days ago",
      latest_digest: {
        id: "2026-10-05",
        kind: "regular",
        date: "2026-10-05",
        items: 5,
        verified: true,
        has_audio: false,
        path: "Digests/2026/10/2026-10-05.md",
      },
      audio: { pending: true, missing: ["2026-10-05"], retention_days: 120 },
      sources: {
        total: 4,
        enabled: 4,
        failure_threshold: 5,
        failing: [{ id: "blog-b", name: "Source blog-b", failures: 5, last_ok: null }],
      },
      budget: {
        speechify: {
          month: "2026-10",
          used: 12_345,
          limit: 450_000,
          monthly_chars: 500_000,
          percent: 2.5,
        },
      },
      warnings: [],
    });
  });

  it("says the next regular digest is due two Stockholm days after the last one", async () => {
    await put(
      "state/last-run.json",
      lastRunFile({ regular: { at: "2026-10-06T21:30:00Z", outcome: "nothing", items: 0 } }),
    );
    const parsed = JSON.parse((await report()).stdout);
    // 23:30 in Stockholm on 6 October: the next one is 8 October, so 7 October is not due.
    expect(parsed).toMatchObject({ next_regular_due: "2026-10-08", due_now: false });
  });

  it("works on an empty repository with a warning for the missing registry", async () => {
    const parsed = JSON.parse((await report()).stdout);
    expect(parsed).toMatchObject({
      last_run: { regular: null, weekly: null, on_demand: null },
      last_fetch_at: null,
      due_now: true,
      next_regular_due: "2026-10-07",
      latest_digest: null,
      audio: { pending: false, missing: [] },
      sources: { total: 0, failing: [] },
    });
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("config/sources.json");
  });

  it("keeps going when a state file is corrupt and says which", async () => {
    await seedRepoFiles();
    await put("state/last-run.json", "{ broken");
    const parsed = JSON.parse((await report()).stdout);
    expect(parsed.last_run.regular).toBeNull();
    expect(parsed.warnings.join(" ")).toContain("state/last-run.json");
    expect(parsed.sources.total).toBe(4);
  });
});

// --- models ------------------------------------------------------------------------------------

// --- extract -----------------------------------------------------------------------------------

describe("singularity extract", () => {
  const items = [...sourceItems("blog-a", 3, "x")];
  const textFor = (item: { id: string }, length: number): ExtractedText => ({
    text: `${item.id} `.repeat(Math.ceil(length / 13)).slice(0, length),
    method: "content",
    truncated: false,
  });

  async function seedPool(id = "2026-10-07"): Promise<void> {
    await writePool(join(scratch, ".cache/run", id, "pool.json"), poolFile(id, items));
  }

  async function extract(args: string[], length = 50) {
    const { ctx, logs } = makeContext(scratch, { json: true });
    const command = makeExtractCommand(
      () => async (item) => (item.title.includes("x-3") ? null : textFor(item, length)),
    );
    const { result, stdout } = await captureStdout(() => command(args, ctx));
    return { code: result, stdout, logs };
  }

  it("prints one JSON object from id to text and nothing else", async () => {
    await seedPool();
    const ids = items.slice(0, 2).map((item) => item.id);
    const { code, stdout } = await extract(["--ids", ids.join(",")]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed)).toEqual(ids);
    expect(typeof parsed[ids[0] as string]).toBe("string");
  });

  it("lists unknown ids and items without readable text on stderr, not in the output", async () => {
    await seedPool();
    const { stdout, logs } = await extract([
      "--ids",
      `${items[0]?.id},${items[2]?.id},deadbeef0000`,
    ]);
    expect(Object.keys(JSON.parse(stdout))).toEqual([items[0]?.id]);
    expect(logs.map((l) => l.message).join("\n")).toContain("Not in the pool: deadbeef0000");
    expect(logs.map((l) => l.message).join("\n")).toContain(
      `No readable text for: ${items[2]?.id}`,
    );
  });

  it("spends a total character budget front to back", async () => {
    await seedPool();
    const ids = items.slice(0, 2).map((item) => item.id);
    const { stdout, logs } = await extract(["--ids", ids.join(","), "--max-chars", "60"], 50);
    const parsed = JSON.parse(stdout) as Record<string, string>;
    expect(parsed[ids[0] as string]).toHaveLength(50);
    expect(Object.values(parsed).join("").length).toBeLessThanOrEqual(60);
    expect(logs.map((l) => l.message).join("\n")).toContain("cap");
  });

  it("reads a named pool", async () => {
    await put("elsewhere/pool.json", JSON.stringify(poolFile("2026-10-07", items)));
    const { stdout } = await extract([
      "--ids",
      String(items[0]?.id),
      "--pool",
      "elsewhere/pool.json",
    ]);
    expect(Object.keys(JSON.parse(stdout))).toEqual([items[0]?.id]);
  });

  it("repeats nothing when an id is listed twice", async () => {
    await seedPool();
    const id = String(items[0]?.id);
    const { stdout } = await extract(["--ids", `${id},${id}`]);
    expect(Object.keys(JSON.parse(stdout))).toEqual([id]);
  });

  it("exits 2 without ids and for a bad cap, and 1 when there is no pool", async () => {
    await seedPool();
    expect((await extract([])).code).toBe(2);
    expect((await extract(["--ids", "a", "--max-chars", "-1"])).code).toBe(2);
    await rm(join(scratch, ".cache"), { recursive: true, force: true });
    const missing = await extract(["--ids", "a"]);
    expect(missing.code).toBe(1);
    expect(missing.logs.find((l) => l.level === "error")?.message).toContain("pool");
  });

  it("extractIds cuts an item at the budget and marks the rest as capped", async () => {
    const result = await extractIds(
      items.map((i) => i.id),
      items,
      async (item) => textFor(item, 40),
      50,
    );
    expect(Object.values(result.texts).join("").length).toBeLessThanOrEqual(50);
    expect(result.capped.length).toBeGreaterThan(0);
  });
});

// --- eval --------------------------------------------------------------------------------------

describe("singularity eval", () => {
  it("refuses without --yes and says it uses keys and money", async () => {
    const calls: string[][] = [];
    const command = makeEvalCommand(async () => async (argv) => {
      calls.push(argv);
      return 0;
    });
    const { ctx } = makeContext(scratch);
    const { result, stderr } = await captureStderr(() => command([], ctx));
    expect(result).toBe(2);
    expect(stderr).toContain("keys");
    expect(stderr).toContain("cents");
    expect(stderr).toContain("--yes");
    expect(calls).toEqual([]);
  });

  it("hands the other flags to the runner and returns its exit code", async () => {
    const calls: string[][] = [];
    const command = makeEvalCommand(async () => async (argv) => {
      calls.push(argv);
      return 3;
    });
    const { ctx, logs } = makeContext(scratch, { json: false });
    const result = await command(["--yes", "--only", "judges", "--models", "a,b"], ctx);
    expect(result).toBe(3);
    expect(calls).toEqual([["--only", "judges", "--models", "a,b"]]);
    expect(logs.some((l) => l.level === "warn" && /spending money/.test(l.message))).toBe(true);
  });

  it("passes the global --json on to the runner once", async () => {
    const calls: string[][] = [];
    const command = makeEvalCommand(async () => async (argv) => {
      calls.push(argv);
      return 0;
    });
    const { ctx } = makeContext(scratch, { json: true });
    await command(["--yes"], ctx);
    await command(["--yes", "--json"], ctx);
    expect(calls).toEqual([["--json"], ["--json"]]);
  });
});

// --- run command -------------------------------------------------------------------------------

describe("singularity run: arguments and output", () => {
  function runCommand() {
    const world = makeWorld(scratch);
    return { world, command: makeRunCommand(() => world.deps) };
  }

  async function runWith(args: string[], jsonOutput = true) {
    const { command } = runCommand();
    const { ctx, logs } = makeContext(scratch, { json: jsonOutput });
    const { result, stdout } = await captureStdout(() => command(args, ctx));
    return { code: result, stdout, logs };
  }

  it("rejects an unknown mode, stage or flag with exit 2 and the usage on stderr", async () => {
    for (const args of [
      ["--mode", "bogus"],
      ["--stage", "nope"],
      ["--bogus"],
      ["--run", "2026-10-07"],
    ]) {
      const { ctx } = makeContext(scratch);
      const { result, stderr } = await captureStderr(() =>
        captureStdout(() => makeRunCommand(() => makeWorld(scratch).deps)(args, ctx)),
      );
      expect(result.result).toBe(2);
      expect(stderr).toContain("Usage: singularity run");
    }
  });

  it("prints the gate's JSON for --stage gate --json", async () => {
    const { code, stdout } = await runWith(["--stage", "gate", "--mode", "on-demand", "--dry-run"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      due: true,
      mode: "on-demand",
      dry_run: true,
      passes: [{ id: "2026-10-07", kind: "on-demand" }],
    });
  });

  it("prints a failed stage as JSON, logs it, and exits 1", async () => {
    const { code, stdout, logs } = await runWith(["--stage", "fetch"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "failed", stage: "fetch" });
    expect(logs.some((l) => l.level === "error" && l.message.includes("fetch failed"))).toBe(true);
  });

  it("prints a gated run as gated with exit 0, in text and JSON", async () => {
    await put(
      "state/last-run.json",
      lastRunFile({ regular: { at: "2026-10-06T05:13:00Z", outcome: "published", items: 5 } }),
    );
    const asJson = await runWith(["--stage", "gate"]);
    expect(JSON.parse(asJson.stdout)).toMatchObject({ due: false, passes: [] });
    const text = await runWith(["--stage", "gate"], false);
    expect(text.stdout).toContain("Not due:");
  });
});

// --- learn ----------------------------------------------------------------------------------

describe("singularity learn", () => {
  let template: string;
  let repo: TestRepo;
  beforeAll(async () => {
    template = await buildTemplate();
  }, 120_000);
  afterAll(async () => {
    await rm(template, { recursive: true, force: true, maxRetries: 3 });
  });
  beforeEach(async () => {
    repo = await instantiate(template);
  }, 60_000);
  afterEach(async () => {
    await repo.cleanup();
  });

  const LONG = { timeout: 90_000 };
  const patch = {
    input: "more motion techniques",
    add_keywords: ["shaders"],
  };

  async function patchFile(content: unknown = patch): Promise<string> {
    const path = join(scratch, "patch.json");
    await writeFile(path, JSON.stringify(content), "utf8");
    return path;
  }

  async function apply(extra: string[], file?: string) {
    const { ctx, logs } = makeContext(repo.root, { json: false });
    const { result } = await captureStdout(async () =>
      learn(["--apply", file ?? (await patchFile()), ...extra], ctx),
    );
    return { code: result, logs };
  }

  const prefs = async (): Promise<string> =>
    readFile(join(repo.root, "config/preferences.json"), "utf8");

  it(
    "writes the preferences file and commits nothing, with or without --commit",
    LONG,
    async () => {
      const before = head(repo.root);
      const { code } = await apply([]);
      expect(code).toBe(0);
      expect(head(repo.root)).toBe(before);
      expect(git(repo.root, "status", "--porcelain")).toContain("config/preferences.json");
    },
  );

  // The bug (D296): the preferences are not in git when the store is on, so a learn that committed
  // would push an ignored file's absence as a change, and one with the store down wrote the file
  // alone, which the next run then undid. The store is the only record; a store it cannot read stops it.
  it(
    "with the config store on, writes the store, commits nothing and stops when it is down",
    LONG,
    async () => {
      const stored = { content: await prefs(), version: 1 };
      let reachable = true;
      const sql = {
        async query(text: string, params: unknown[] = []) {
          if (!reachable) throw new Error("connect ECONNREFUSED");
          if (text.startsWith("select path, content, version"))
            return [{ path: "config/preferences.json", ...stored }];
          const [, contents, versions] = params as [string[], string[], number[]];
          if (versions[0] !== stored.version) return [{ written: 0 }];
          Object.assign(stored, { content: contents[0], version: stored.version + 1 });
          return [{ written: 1 }];
        },
      };
      const env = { DATABASE_URL: "postgres://fake", SINGULARITY_CONFIG_STORE: "postgres" };
      const withStore = async (extra: string[]) => {
        const { ctx } = makeContext(repo.root, { env, json: false });
        const run = makeLearn({ connectConfigStore: async () => sql });
        return (await captureStdout(async () => run(["--apply", await patchFile(), ...extra], ctx)))
          .result;
      };
      const weight = () =>
        (
          JSON.parse(stored.content) as { preferred_keywords: string[] }
        ).preferred_keywords.includes("shaders");

      reachable = false;
      expect(await withStore([])).toBe(1);
      expect(git(repo.root, "status", "--porcelain")).toBe("");
      reachable = true;

      const head = git(repo.root, "rev-parse", "HEAD");
      expect(await withStore(["--commit"])).toBe(0);
      expect(weight()).toBe(true);
      expect(stored.version).toBe(2);
      expect(git(repo.root, "rev-parse", "HEAD")).toBe(head);
    },
  );
});

// --- job summary -------------------------------------------------------------------------------

describe("singularity run: the GitHub job summary", () => {
  async function runWithSummary(args: string[], summary: string | undefined) {
    const world = makeWorld(scratch);
    const command = makeRunCommand(
      () => world.deps,
      () => summary,
    );
    const { ctx } = makeContext(scratch, { json: true });
    return captureStdout(() => command(args, ctx));
  }

  it("appends what the stage did to the file GitHub names", async () => {
    const summary = join(scratch, "summary.md");
    await runWithSummary(["--stage", "gate"], summary);
    const text = await readFile(summary, "utf8");
    expect(text).toContain("### singularity run --stage gate");
    expect(text).toContain("Run is due (scheduled)");
    expect(text).toContain("2026-10-07 (regular)");
  });

  it("appends stage after stage, so the run page shows the whole run", async () => {
    await put("config/sources.json", json(sourcesFile()));
    await put(
      "config/preferences.json",
      await readFile(join(FIXTURE_CONFIG, "preferences.json"), "utf8"),
    );
    const summary = join(scratch, "summary.md");
    await runWithSummary(["--stage", "gate"], summary);
    await runWithSummary(["--stage", "fetch"], summary);
    const text = await readFile(summary, "utf8");
    expect(text.indexOf("run --stage gate")).toBeLessThan(text.indexOf("run --stage fetch"));
    expect(text).toContain("Stage fetch done");
    expect(text).toContain("failed_sources");
  });

  it("records a failed stage with its one-line error", async () => {
    const summary = join(scratch, "summary.md");
    const { result } = await runWithSummary(["--stage", "judge"], summary);
    expect(result).toBe(1);
    expect(await readFile(summary, "utf8")).toContain("Failed at judge: No plan found");
  });

  it("writes nothing without GITHUB_STEP_SUMMARY and never fails the run when it cannot write", async () => {
    expect((await runWithSummary(["--stage", "gate"], undefined)).result).toBe(0);
    // A directory cannot be appended to.
    expect((await runWithSummary(["--stage", "gate"], scratch)).result).toBe(0);
  });
});
