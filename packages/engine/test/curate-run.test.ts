import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDigestFile } from "@singularity/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeCurateCommand } from "../src/commands/curate.js";
import { makeRenderCommand } from "../src/commands/render.js";
import type { ApiRuntimeFactory } from "../src/curate/apiRuntime.js";
import { parsePool } from "../src/curate/inputs.js";
import { findLatestRunDir, resolveRunLocation } from "../src/curate/runDir.js";
import { Selection } from "../src/curate/selectionFile.js";
import {
  captureStdout,
  fakeWriter,
  goodSpecs,
  keywordGrounder,
  longText,
  makeContext,
  makePool,
  makeRoot,
  TableJudge,
  type TestRoot,
  writeRunFile,
} from "./curate-helpers.js";
import { COVER, makeFixture } from "./render-factories.js";

const ENV = { SINGULARITY_MODEL: "Qwen/Qwen3-32B" };
const FETCH_WINDOW = { from: "2026-10-01T05:13:00Z", to: "2026-10-06T05:13:00Z" };

let tr: TestRoot;
beforeEach(async () => {
  tr = await makeRoot();
});
afterEach(async () => {
  await tr.cleanup();
});

/** The shape `singularity fetch` writes: a header plus the ranked items. */
const fetchPool = (items: unknown[], header: Record<string, unknown> = {}) => ({
  version: 1,
  id: "2026-10-06",
  kind: "weekly",
  generated_at: "2026-10-06T05:13:00Z",
  window: FETCH_WINDOW,
  sources: [],
  report: {},
  items,
  ...header,
});

const factoryFor =
  (table: ReturnType<typeof makePool>["table"]): ApiRuntimeFactory =>
  () => ({
    judge: new TableJudge(table),
    writer: fakeWriter(),
    grounder: keywordGrounder,
    extract: async (item) => longText(item),
    judgeFailures: [],
    usage: () => ({ tokens: 1, tokenLimit: 400_000 }),
  });

describe("parsePool", () => {
  it("returns no metadata for a bare array", () => {
    expect(parsePool([]).meta).toEqual({});
  });

  it("reads the id, kind and window the fetch recorded", () => {
    const parsed = parsePool(fetchPool([]));
    expect(parsed.meta).toEqual({ id: "2026-10-06", kind: "weekly", window: FETCH_WINDOW });
  });

  it("keeps the fields it can read when another field is malformed", () => {
    const parsed = parsePool(fetchPool([], { id: "nope", window: { from: "x" } }));
    expect(parsed.meta).toEqual({ kind: "weekly" });
  });
});

describe("run location", () => {
  const seedRun = async (id: string, mtimeSeconds: number): Promise<string> => {
    const dir = join(tr.root, ".cache", "run", id);
    await mkdir(dir, { recursive: true });
    const pool = join(dir, "pool.json");
    await writeFile(pool, "[]");
    await utimes(pool, mtimeSeconds, mtimeSeconds);
    return dir;
  };

  it("finds the newest run that has a pool, ignoring directories without one", async () => {
    await seedRun("2026-10-01", 1_000);
    const newest = await seedRun("2026-10-03", 3_000);
    await mkdir(join(tr.root, ".cache", "run", "2026-10-09"), { recursive: true });
    expect(await findLatestRunDir(tr.root)).toBe(newest);
  });

  it("returns null when there is no run", async () => {
    expect(await findLatestRunDir(tr.root)).toBeNull();
  });

  it("resolves --run, --pool, both, and neither", async () => {
    const latest = await seedRun("2026-10-03", 3_000);
    const byRun = await resolveRunLocation(tr.root, { run: "2026-10-01" });
    expect(byRun.runDir).toBe(join(tr.root, ".cache", "run", "2026-10-01"));
    expect(byRun.poolPath).toBe(join(byRun.runDir, "pool.json"));

    const byPool = await resolveRunLocation(tr.root, { pool: "somewhere/else/my-pool.json" });
    expect(byPool.runDir).toBe(join(tr.root, "somewhere", "else"));
    expect(byPool.poolPath).toBe(join(tr.root, "somewhere", "else", "my-pool.json"));

    const both = await resolveRunLocation(tr.root, { run: "2026-10-01", pool: "x/p.json" });
    expect(both.runDir).toBe(join(tr.root, ".cache", "run", "2026-10-01"));
    expect(both.poolPath).toBe(join(tr.root, "x", "p.json"));

    expect((await resolveRunLocation(tr.root, {})).runDir).toBe(latest);
  });

  it("explains what to do when there is nothing to find", async () => {
    await expect(resolveRunLocation(tr.root, {})).rejects.toThrow(/Run `singularity fetch` first/);
  });

  it("rejects a run id that is a path", async () => {
    await expect(resolveRunLocation(tr.root, { run: "a/b" })).rejects.toThrow(/Invalid run id/);
  });
});

describe("curate with the pool singularity fetch writes", () => {
  it("takes the kind, run id and window from the pool", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, "2026-10-06", "pool.json", fetchPool(pool.items));
    const { ctx } = makeContext(tr.root, { env: ENV });
    const { result, stdout } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table))([], ctx),
    );
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ run_id: "2026-10-06", outcome: "selected" });
    const selection = Selection.parse(
      JSON.parse(
        await readFile(join(tr.root, ".cache", "run", "2026-10-06", "selection.json"), "utf8"),
      ),
    );
    expect(selection.kind).toBe("weekly");
    expect(selection.window).toEqual(FETCH_WINDOW);
  });

  it("lets --kind and --since override the pool", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, "2026-10-06", "pool.json", fetchPool(pool.items));
    const { ctx } = makeContext(tr.root, { env: ENV });
    await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table))(
        ["--kind", "on-demand", "--since", "2026-10-06T00:00:00Z"],
        ctx,
      ),
    );
    const selection = Selection.parse(
      JSON.parse(
        await readFile(join(tr.root, ".cache", "run", "2026-10-06", "selection.json"), "utf8"),
      ),
    );
    expect(selection.kind).toBe("on-demand");
    expect(selection.window.from).toBe("2026-10-06T00:00:00.000Z");
  });

  it("writes outputs next to a pool given by --pool", async () => {
    const pool = makePool(goodSpecs(5));
    const poolPath = await writeRunFile(tr.root, "custom", "pool.json", fetchPool(pool.items));
    const { ctx } = makeContext(tr.root, { env: ENV });
    await captureStdout(() => makeCurateCommand(factoryFor(pool.table))(["--pool", poolPath], ctx));
    expect(
      Selection.safeParse(
        JSON.parse(
          await readFile(join(tr.root, ".cache", "run", "custom", "selection.json"), "utf8"),
        ),
      ).success,
    ).toBe(true);
  });
});

describe("render with the pool singularity fetch writes", () => {
  const seed = async (id: string): Promise<void> => {
    const fixture = makeFixture(5);
    await writeRunFile(tr.root, id, "pool.json", fetchPool(fixture.items, { id, kind: "regular" }));
    await writeRunFile(tr.root, id, "selection.json", {
      version: 1,
      kind: "regular",
      mode: "api",
      outcome: "selected",
      verified: false,
      window: FETCH_WINDOW,
      items: fixture.selected.map((sel) => {
        const text = fixture.written.find((w) => w.id === sel.item.id);
        return {
          id: sel.item.id,
          category: sel.category,
          score: sel.score,
          headline: text?.headline,
          summary: text?.summary,
          why: text?.why,
        };
      }),
    });
  };

  it("uses the id the fetch reserved, even when it names an earlier day", async () => {
    await seed("2026-10-06");
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() =>
      makeRenderCommand({ coverPicker: () => COVER })([], ctx),
    );
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      digest_id: "2026-10-06",
      path: "Digests/2026/10/2026-10-06.md",
    });
    const digest = parseDigestFile(
      await readFile(join(tr.root, "Digests", "2026", "10", "2026-10-06.md"), "utf8"),
    );
    expect(digest.id).toBe("2026-10-06");
    expect(digest.date).toBe("2026-10-06");
  });

  it("finds the pool next to a selection given by --selection alone", async () => {
    await seed("2026-10-06");
    const { ctx } = makeContext(tr.root);
    const selectionPath = join(tr.root, ".cache", "run", "2026-10-06", "selection.json");
    const { result, stdout } = await captureStdout(() =>
      makeRenderCommand({ coverPicker: () => COVER })(
        ["--selection", selectionPath, "--dry-run"],
        ctx,
      ),
    );
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "dry-run", digest_id: "2026-10-06" });
  });

  it("picks the newest run that has a selection when no run is named", async () => {
    await seed("2026-10-05");
    await seed("2026-10-06");
    await utimes(join(tr.root, ".cache", "run", "2026-10-05", "selection.json"), 9_000, 9_000);
    await utimes(join(tr.root, ".cache", "run", "2026-10-06", "selection.json"), 1_000, 1_000);
    const { ctx } = makeContext(tr.root);
    const { stdout } = await captureStdout(() =>
      makeRenderCommand({ coverPicker: () => COVER })(["--dry-run"], ctx),
    );
    expect(JSON.parse(stdout)).toMatchObject({ digest_id: "2026-10-05" });
  });

  it("takes the next free suffix when that id was used in the meantime", async () => {
    await seed("2026-10-06");
    const { ctx } = makeContext(tr.root);
    const render = makeRenderCommand({ coverPicker: () => COVER });
    await captureStdout(() => render([], ctx));
    const { stdout } = await captureStdout(() => render([], ctx));
    expect(JSON.parse(stdout)).toMatchObject({ digest_id: "2026-10-06-2" });
  });
});
