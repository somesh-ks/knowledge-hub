import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Item, itemId, type LastRunFile, type SeenFile } from "@dispatch/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run as renderCommand } from "../src/commands/render.js";
import { run as validateCommand } from "../src/commands/validate.js";
import { Selection, WrittenFile } from "../src/curate/selectionFile.js";
import { PoolFile, writePool } from "../src/fetch/pool.js";
import type { Judge } from "../src/judge/types.js";
import { captureStdout, fakeWriter, makeContext, okWritten } from "./curate-helpers.js";
import { commitAll, git, put } from "./git-testRepo.js";
import {
  buildTemplate,
  exists,
  feedItem,
  goodFeeds,
  head,
  instantiate,
  makeWorld,
  PatternJudge,
  readDigest,
  readJson,
  runStage,
  sourceItems,
  type TestRepo,
  WED,
} from "./orchestrator-fixtures.js";

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

const DIGEST_PATH = "Digests/2026/10/2026-10-07.md";
const LONG = { timeout: 90_000 };

/** Run gate through validate, so only the commit stage is left. */
async function throughValidate(world: ReturnType<typeof makeWorld>): Promise<void> {
  for (const stage of ["gate", "fetch", "judge", "write", "validate"] as const) {
    const result = await runStage(world, { stage });
    expect(result.code).toBe(0);
  }
}

describe("concurrent writers and push handling", () => {
  it("rebases onto a commit another writer pushed first", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    await put(repo.other, "notes.txt", "from another writer\n");
    await commitAll(repo.other, "docs: add a note");
    git(repo.other, "push", "-q", "origin", "main");

    const commit = await runStage(world, { stage: "commit" });
    expect(commit.report).toMatchObject({ outcome: "published", commit: { status: "pushed" } });
    expect(git(repo.remote, "log", "--format=%s", "-3").split("\n")).toEqual([
      "chore(digest): 2026-10-07",
      "docs: add a note",
      "chore: seed",
    ]);
    expect(git(repo.remote, "rev-parse", "main")).toBe(head(repo.root));
  });

  it("commits locally and skips the push with --no-push", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const remoteBefore = git(repo.remote, "rev-parse", "main");
    const result = await runStage(world, { noPush: true });
    expect(result.report).toMatchObject({
      outcome: "published",
      deploy: true,
      commit: { status: "committed" },
    });
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07");
    expect(git(repo.remote, "rev-parse", "main")).toBe(remoteBefore);
  });

  it(
    "reports a failed push as failed, keeps the local commit and never deploys",
    LONG,
    async () => {
      const world = makeWorld(repo.root, { now: WED });
      await throughValidate(world);
      git(repo.root, "remote", "set-url", "origin", join(repo.remote, "..", "missing.git"));
      const commit = await runStage(world, { stage: "commit" });
      expect(commit.code).toBe(1);
      expect(commit.report).toMatchObject({
        outcome: "failed",
        deploy: false,
        commit: { status: "push_failed" },
      });
      expect(JSON.stringify(commit.report)).toContain("push failed");
      expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07");
    },
  );

  it("will not commit the same plan twice", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world);
    const before = head(repo.root);
    const again = await runStage(world, { stage: "commit" });
    expect(again.code).toBe(1);
    expect(JSON.stringify(again.report)).toContain("already committed");
    expect(head(repo.root)).toBe(before);
  });

  it("refuses before writing when the tree has changes outside the allowlist", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    await writeFile(join(repo.root, "README.md"), "edited by hand\n", "utf8");
    const before = head(repo.root);
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.code).toBe(1);
    expect(JSON.stringify(commit.report)).toContain("outside the write allowlist");
    expect(JSON.stringify(commit.report)).toContain("README.md");
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
    expect(await exists(repo.root, "state/last-run.json")).toBe(false);
    expect(head(repo.root)).toBe(before);
  });

  it("takes the next free id when the planned one appeared meanwhile", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    await mkdir(join(repo.root, "Digests/2026/10"), { recursive: true });
    await writeFile(join(repo.root, DIGEST_PATH), "written by someone else\n", "utf8");
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.report).toMatchObject({ digests: [{ id: "2026-10-07-2" }] });
    expect(await readFile(join(repo.root, DIGEST_PATH), "utf8")).toBe("written by someone else\n");
    expect((await readDigest(repo.root, "Digests/2026/10/2026-10-07-2.md")).id).toBe(
      "2026-10-07-2",
    );
  });
});

describe("grounding and validation", () => {
  const firstId = (): string => (goodFeeds(8)["blog-a"] as Item[])[0]?.id as string;

  function writerUnsupportedFor(ids: readonly string[]) {
    return fakeWriter({
      write: (material) =>
        ids.includes(material.id)
          ? {
              ...okWritten(material),
              summary: `UNSUPPORTED claim about springs. ${okWritten(material).summary}`,
            }
          : okWritten(material),
    });
  }

  it("drops an item whose sentence the source does not support", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED, writer: writerUnsupportedFor([firstId()]) });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published", items: 7 });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items.map((item) => item.id)).not.toContain(firstId());
    expect(digest.verified).toBe(true);

    const written = WrittenFile.parse(
      await readJson(repo.root, ".cache/run/2026-10-07/written.json"),
    );
    expect(written.dropped).toContainEqual(
      expect.objectContaining({ id: firstId(), stage: "grounding" }),
    );
    expect(written.items.every((entry) => entry.verified)).toBe(true);
  });

  it("re-checks the floor after grounding and records a quiet day", LONG, async () => {
    const feeds = { "blog-a": goodFeeds(8)["blog-a"] as Item[] };
    const ids = feeds["blog-a"].slice(0, 2).map((item) => item.id);
    const world = makeWorld(repo.root, { now: WED, feeds, writer: writerUnsupportedFor(ids) });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing", items: 0 });
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items)).toHaveLength(3);
  });

  it("leaves a selection the render and validate commands accept", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    const selection = Selection.parse(
      await readJson(repo.root, ".cache/run/2026-10-07/selection.json"),
    );
    expect(selection).toMatchObject({ mode: "api", outcome: "selected", verified: true });

    const { ctx } = makeContext(repo.root, { json: true });
    const rendered = await captureStdout(() =>
      renderCommand(["--run", "2026-10-07", "--dry-run"], ctx),
    );
    expect(rendered.result).toBe(0);
    expect(JSON.parse(rendered.stdout)).toMatchObject({ outcome: "dry-run", items: 8 });

    await runStage(world, { stage: "commit" });
    const validated = await captureStdout(() =>
      validateCommand([DIGEST_PATH, "--pool", ".cache/run/2026-10-07/pool.json"], ctx),
    );
    expect(validated.result).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({ ok: true, errors: 0 });
  });

  it("writes a pool in the format dispatch fetch writes", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate" });
    await runStage(world, { stage: "fetch" });
    const pool = PoolFile.parse(await readJson(repo.root, ".cache/run/2026-10-07/pool.json"));
    expect(pool).toMatchObject({ id: "2026-10-07", kind: "regular" });
    expect(pool.items).toHaveLength(8);
    expect(pool.report.fetched).toBe(8);
    expect(pool.sources.map((s) => s.source_id).sort()).toEqual(["blog-a", "blog-b", "blog-c"]);
  });
});

describe("judges", () => {
  it("reports items the fallback judge answered and logs the switch", LONG, async () => {
    const judge: Judge = {
      name: "fallback",
      model: "jev-latest",
      questionsHash: "abc123def456",
      judge: (items) => new PatternJudge(() => WED, "nebius-model").judge(items),
    };
    const world = makeWorld(repo.root, { now: WED, judge });
    await runStage(world, { stage: "gate" });
    await runStage(world, { stage: "fetch" });
    const result = await runStage(world, { stage: "judge" });
    expect(result.report).toMatchObject({
      stage: "judge",
      passes: [{ id: "2026-10-07", judge: "fallback", model: "jev-latest", fallback: 8, fresh: 8 }],
    });
    expect(
      world.logs.some(
        (line) => line.level === "warn" && /fallback judge answered/i.test(line.message),
      ),
    ).toBe(true);
  });

  it(
    "does not warn about the fallback when the primary judge answered everything",
    LONG,
    async () => {
      const world = makeWorld(repo.root, { now: WED });
      await runStage(world, { stage: "gate" });
      await runStage(world, { stage: "fetch" });
      await runStage(world, { stage: "judge" });
      expect(world.logs.some((line) => /fallback judge/i.test(line.message))).toBe(false);
    },
  );
});

describe("agent mode", () => {
  async function writeAgentRun(
    id = "2026-10-07",
    kind: "regular" | "on-demand" = "on-demand",
    mode: "agent" | "api" = "agent",
  ): Promise<Item[]> {
    const items = Object.values(goodFeeds(6)).flat();
    const dir = join(repo.root, ".cache", "run", id);
    const pool: PoolFile = {
      version: 1,
      id,
      kind: "regular",
      generated_at: WED.toISOString(),
      window: { from: "2026-10-05T05:13:00.000Z", to: WED.toISOString() },
      sources: [],
      report: {
        fetched: items.length,
        dedupe: {
          input: items.length,
          already_seen: 0,
          same_url: 0,
          newsletter_collapsed: 0,
          near_duplicate: 0,
          story_clustered: 0,
          output: items.length,
        },
        prefilter: {
          input: items.length,
          kept: items.length,
          dropped: { disliked: 0, not_relevant: 0, source_cap: 0, cap: 0 },
          tech: { input: 0, kept: 0, source_cap: 0, cap: 0 },
          trending: { input: 0, single_outlet: 0, kept: 0, source_cap: 0, cap: 0 },
        },
      },
      items,
    };
    await writePool(join(dir, "pool.json"), pool);
    const selection: Selection = {
      version: 1,
      kind,
      mode,
      outcome: "selected",
      verified: mode === "api",
      window: pool.window,
      items: items.slice(0, 4).map((item, index) => ({
        id: item.id,
        category: "design_engineering_craft",
        score: 0.9 - index * 0.05,
        headline: `Springlet ${index + 1} retargets springs mid-flight`,
        summary: `Springlet ${index + 1} swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.`,
      })),
    };
    await writeFile(join(dir, "selection.json"), `${JSON.stringify(selection, null, 2)}\n`, "utf8");
    return items;
  }

  it("commits a validated agent selection without a gate plan", LONG, async () => {
    await writeAgentRun();
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { stage: "commit" });
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      outcome: "published",
      deploy: true,
      items: 4,
      digests: [{ id: "2026-10-07", kind: "on-demand", verified: false }],
    });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest).toMatchObject({ kind: "on-demand", verified: false });
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07");
    const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(lastRun.on_demand).toMatchObject({ outcome: "published", digest_id: "2026-10-07" });
    expect(lastRun.regular).toBeUndefined();
    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items)).toHaveLength(4);
  });

  it("never marks an agent selection verified, whatever the file says", LONG, async () => {
    await writeAgentRun();
    const path = join(repo.root, ".cache/run/2026-10-07/selection.json");
    const selection = JSON.parse(await readFile(path, "utf8")) as Selection;
    await writeFile(path, JSON.stringify({ ...selection, verified: true }), "utf8");
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "commit" });
    expect((await readDigest(repo.root, DIGEST_PATH)).verified).toBe(false);
  });

  it("will not commit the same agent run twice", LONG, async () => {
    await writeAgentRun();
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "commit" });
    const again = await runStage(world, { stage: "commit" });
    expect(again.code).toBe(1);
    expect(JSON.stringify(again.report)).toContain("No plan found");
    expect(await exists(repo.root, "Digests/2026/10/2026-10-07-2.md")).toBe(false);
  });

  it("adopts a named run directory with --run", LONG, async () => {
    await writeAgentRun("2026-10-07", "regular");
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { stage: "commit", run: "2026-10-07" });
    expect(result.report).toMatchObject({ digests: [{ id: "2026-10-07", kind: "regular" }] });
    const again = await runStage(world, { stage: "commit", run: "2026-10-07" });
    expect(JSON.stringify(again.report)).toContain("already committed");
  });

  it("does not adopt a selection the API curator wrote", LONG, async () => {
    await writeAgentRun("2026-10-07", "regular", "api");
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { stage: "commit" });
    expect(result.code).toBe(1);
    expect(JSON.stringify(result.report)).toContain("No plan found");
  });

  it("adopts an agent run written after a gated plan", LONG, async () => {
    const earlier = new Date("2026-10-05T05:13:00Z");
    await put(
      repo.root,
      "state/last-run.json",
      `${JSON.stringify({ version: 1, regular: { at: "2026-10-05T04:00:00Z", outcome: "published", items: 5 } })}\n`,
    );
    await commitAll(repo.root, "chore: seed state");
    git(repo.root, "push", "-q", "origin", "main");
    const world = makeWorld(repo.root, { now: earlier });
    const gate = await runStage(world, { stage: "gate" });
    expect(gate.report).toMatchObject({ due: false });
    await writeAgentRun();
    const result = await runStage(world, { stage: "commit" });
    expect(result.report).toMatchObject({ outcome: "published" });
  });

  it("prefers the gate's plan over a leftover agent run", LONG, async () => {
    await writeAgentRun();
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate" });
    // The gate planned a regular digest, so the plan wins over any leftover agent run.
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.code).toBe(1);
    expect(JSON.stringify(commit.report)).toContain("validate stage has not run");
  });

  it("previews an agent run with --dry-run and writes nothing", LONG, async () => {
    await writeAgentRun();
    const before = head(repo.root);
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { stage: "commit", dryRun: true });
    expect(result.report).toMatchObject({ outcome: "published", dry_run: true, deploy: false });
    expect(head(repo.root)).toBe(before);
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
    expect(await exists(repo.root, ".cache/run/2026-10-07/digest-preview.md")).toBe(true);
  });
});

describe("items a judge could not answer", () => {
  it("keeps unjudged items out of seen so the next run retries them", LONG, async () => {
    const feeds = {
      "blog-a": [
        ...sourceItems("blog-a", 2, "keep"),
        feedItem({ sourceId: "blog-a", slug: "meh", tag: "none" }),
        feedItem({ sourceId: "blog-a", slug: "retry-me", tag: "skip" }),
      ],
    };
    const world = makeWorld(repo.root, { now: WED, feeds });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing" });
    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items)).not.toContain(itemId("https://blog-a.example/retry-me"));
    expect(Object.keys(seen.items)).toHaveLength(3);
  });
});
