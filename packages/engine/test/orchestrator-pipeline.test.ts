import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  COVER_TEMPLATES,
  type JudgmentsFile,
  type LastRunFile,
  type SeenFile,
  type SourceHealthFile,
} from "@dispatch/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  digestFile,
  exists,
  feedItem,
  goodFeeds,
  head,
  instantiate,
  json,
  lastRunFile,
  makeWorld,
  readDigest,
  readJson,
  runStage,
  runStaged,
  SUN,
  seed,
  sourceItems,
  sourcesFile,
  type TestRepo,
  techItem,
  techSource,
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

function changedInHead(cwd: string): string[] {
  return git(cwd, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
}

describe("published run", () => {
  it("runs one stage per call and publishes a digest, as the workflow does", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const results = await runStaged(world);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);

    expect(results[0]?.report).toMatchObject({
      due: true,
      mode: "scheduled",
      dry_run: false,
      passes: [{ id: "2026-10-07", kind: "regular", window: { to: WED.toISOString() } }],
    });
    const commit = results[5]?.report;
    expect(commit).toMatchObject({
      outcome: "published",
      deploy: true,
      dry_run: false,
      digests: [
        {
          id: "2026-10-07",
          kind: "regular",
          outcome: "published",
          verified: true,
          path: DIGEST_PATH,
        },
      ],
    });
    expect(commit).toHaveProperty("items", 8);
  });

  it("writes the digest file with a cover from the cover package", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest).toMatchObject({
      id: "2026-10-07",
      date: "2026-10-07",
      kind: "regular",
      verified: true,
      audio: null,
      generated_at: WED.toISOString(),
    });
    expect(digest.items).toHaveLength(8);
    expect(digest.items.filter((item) => item.section === "top")).toHaveLength(3);
    // The writer produces four-beat summaries and no why line, so the file carries none.
    for (const item of digest.items) {
      expect(item).not.toHaveProperty("why");
      expect(item.summary.split(". ").length).toBe(3);
    }
    const fileText = await readFile(join(repo.root, DIGEST_PATH), "utf8");
    expect(fileText).not.toMatch(/^\s+why:/m);
    expect(fileText).not.toContain("Why:");
    expect(COVER_TEMPLATES).toContain(digest.cover.template);
    const state = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(state.last_cover).toEqual({
      template: digest.cover.template,
      palette: digest.cover.palette,
    });
  });

  it("updates seen, judgments, last-run and source health", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    const digest = await readDigest(repo.root, DIGEST_PATH);

    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items).sort()).toEqual(digest.items.map((i) => i.id).sort());
    expect(new Set(Object.values(seen.items))).toEqual(new Set(["2026-10-07"]));

    const judgments = await readJson<JudgmentsFile>(repo.root, "state/judgments.json");
    expect(Object.keys(judgments.entries)).toHaveLength(8);

    const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(lastRun.regular).toEqual({
      at: WED.toISOString(),
      outcome: "published",
      digest_id: "2026-10-07",
      items: 8,
    });
    expect(lastRun.last_fetch_at).toBe(WED.toISOString());
    expect(lastRun.weekly).toBeUndefined();
    expect(lastRun.on_demand).toBeUndefined();

    const health = await readJson<SourceHealthFile>(repo.root, "state/source-health.json");
    expect(Object.keys(health.sources).sort()).toEqual(["blog-a", "blog-b", "blog-c"]);
  });

  it("commits as chore(digest), authored by the bot, and pushes", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07");
    expect(git(repo.root, "log", "-1", "--format=%an")).toBe("dispatch-bot");
    expect(git(repo.remote, "rev-parse", "main")).toBe(head(repo.root));
    expect(changedInHead(repo.root)).toEqual([
      DIGEST_PATH,
      "state/judgments.json",
      "state/last-run.json",
      "state/seen.json",
      "state/source-health.json",
      "state/source-stats.json",
    ]);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("runs every stage in one call and prints the commit report", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world);
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({ outcome: "published", deploy: true, items: 8 });
    expect(result.report).toHaveProperty("commit.status", "pushed");
    expect(await exists(repo.root, DIGEST_PATH)).toBe(true);
  });

  it("never repeats the previous cover on the next digest", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    const first = await readDigest(repo.root, DIGEST_PATH);

    world.setNow(new Date("2026-10-09T05:13:00Z"));
    world.feeds = goodFeeds(8, "next");
    await runStaged(world);
    const second = await readDigest(repo.root, "Digests/2026/10/2026-10-09.md");
    expect(second.cover.template).not.toBe(first.cover.template);
    expect(second.cover.palette).not.toBe(first.cover.palette);
  });

  it("marks the digest unverified when no grounder is configured", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED, grounder: null });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published" });
    expect((await readDigest(repo.root, DIGEST_PATH)).verified).toBe(false);
  });
});

describe("second run on the same day", () => {
  it("allocates -2 and never overwrites the first digest", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world);
    const first = await readDigest(repo.root, DIGEST_PATH);

    world.setNow(new Date("2026-10-07T12:00:00Z"));
    world.feeds = goodFeeds(6, "later");
    const second = await runStage(world, { mode: "on-demand" });
    expect(second.report).toMatchObject({
      outcome: "published",
      digests: [{ id: "2026-10-07-2", kind: "on-demand" }],
    });
    expect(await readDigest(repo.root, DIGEST_PATH)).toEqual(first);
    expect((await readDigest(repo.root, "Digests/2026/10/2026-10-07-2.md")).kind).toBe("on-demand");
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07-2");
  });

  it("records on_demand and leaves the regular cadence where it was", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world);
    const before = await readJson<LastRunFile>(repo.root, "state/last-run.json");

    const later = new Date("2026-10-07T15:00:00Z");
    world.setNow(later);
    world.feeds = goodFeeds(6, "later");
    await runStage(world, { mode: "on-demand" });
    const after = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(after.regular).toEqual(before.regular);
    expect(after.on_demand).toMatchObject({ outcome: "published", digest_id: "2026-10-07-2" });
    // The fetch window still moves on, so the next run does not re-read what this one saw.
    expect(after.last_fetch_at).toBe(later.toISOString());

    const gate = await runStage(world, { stage: "gate" });
    expect(gate.report).toMatchObject({ due: false });
  });

  it("starts the on-demand window where the last fetch ended", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world);
    world.setNow(new Date("2026-10-07T12:00:00Z"));
    world.feeds = goodFeeds(6, "later");
    const gate = await runStage(world, { stage: "gate", mode: "on-demand" });
    expect(gate.report).toMatchObject({
      passes: [{ window: { from: WED.toISOString(), to: "2026-10-07T12:00:00.000Z" } }],
    });
  });
});

describe("nothing outcome", () => {
  function quietFeeds() {
    return {
      "blog-a": [
        ...sourceItems("blog-a", 2, "keep"),
        feedItem({ sourceId: "blog-a", slug: "meh-1", tag: "none" }),
      ],
      "blog-b": [
        feedItem({ sourceId: "blog-b", slug: "meh-2", tag: "none" }),
        feedItem({ sourceId: "blog-b", slug: "meh-3", tag: "venture_capital_and_gossip" }),
      ],
    };
  }

  it("records a quiet day when fewer than three items clear the bar", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED, feeds: quietFeeds() });
    const result = await runStage(world);
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({
      outcome: "nothing",
      deploy: false,
      items: 0,
      digests: [{ id: "2026-10-07", outcome: "nothing", path: null }],
      reason: "Nothing cleared the bar.",
    });
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe(
      "chore(state): run 2026-10-07 nothing cleared the bar",
    );
  });

  it("advances the fetch window and records every judged item as seen", LONG, async () => {
    const feeds = quietFeeds();
    const world = makeWorld(repo.root, { now: WED, feeds });
    await runStage(world);
    const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(lastRun.regular).toEqual({ at: WED.toISOString(), outcome: "nothing", items: 0 });
    expect(lastRun.last_fetch_at).toBe(WED.toISOString());
    expect(lastRun.last_cover).toBeUndefined();
    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items)).toHaveLength(5);
    const judgments = await readJson<JudgmentsFile>(repo.root, "state/judgments.json");
    expect(Object.keys(judgments.entries)).toHaveLength(5);
  });

  it("counts a quiet day toward the cadence", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED, feeds: quietFeeds() });
    await runStage(world);
    const gate = await runStage(world, { stage: "gate" });
    expect(gate.report).toMatchObject({ due: false });
  });

  it("is nothing too when writing leaves fewer than three items", LONG, async () => {
    const world = makeWorld(repo.root, {
      now: WED,
      feeds: { "blog-a": sourceItems("blog-a", 4, "w") },
    });
    // Two of four finalists use a banned word the single rewrite does not fix.
    const writer = (await world.deps.runtime()).writer;
    const original = writer.write.bind(writer);
    writer.write = async (items) => {
      const result = await original(items);
      return {
        ...result,
        written: result.written.map((w, index) =>
          index < 2 ? { ...w, summary: "A game-changing release for drawers." } : w,
        ),
      };
    };
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing" });
  });

  it(
    "fails instead of recording a quiet day when most finalists cannot be written",
    LONG,
    async () => {
      const world = makeWorld(repo.root, {
        now: WED,
        feeds: { "blog-a": sourceItems("blog-a", 5, "w") },
      });
      const writer = (await world.deps.runtime()).writer;
      writer.write = async (items) => ({
        written: [],
        failed: items.map((item) => ({ id: item.id, reason: "The model returned no entry." })),
      });
      const result = await runStage(world);
      expect(result.code).toBe(1);
      expect(result.report).toMatchObject({ outcome: "failed", stage: "write" });
      expect(await exists(repo.root, "state/last-run.json")).toBe(false);
    },
  );
});

describe("gated run", () => {
  const publishedYesterday = lastRunFile({
    regular: {
      at: "2026-10-06T05:13:00Z",
      outcome: "published",
      digest_id: "2026-10-06",
      items: 8,
    },
    last_fetch_at: "2026-10-06T05:13:00Z",
  });

  it("ends as gated with exit 0, no stage work and no commit", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": publishedYesterday });
    const before = head(repo.root);
    const world = makeWorld(repo.root, { now: WED });
    const results = await runStaged(world);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(results[0]?.report).toMatchObject({ due: false, passes: [] });
    expect(results[0]?.report).toHaveProperty("reason");
    expect(results[1]?.report).toMatchObject({
      outcome: "gated",
      deploy: false,
      items: 0,
      digests: [],
    });
    expect(world.fetchCalls).toEqual([]);
    expect(head(repo.root)).toBe(before);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("stops cleanly in a combined run when the gate says not due", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": publishedYesterday });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world);
    expect(result.code).toBe(0);
    expect(result.report).toMatchObject({ outcome: "gated" });
    expect(world.fetchCalls).toEqual([]);
  });

  it("asks for a deploy when a recent digest still lacks audio", LONG, async () => {
    await seed(repo.root, {
      "state/last-run.json": publishedYesterday,
      "Digests/2026/10/2026-10-06.md": digestFile("2026-10-06"),
    });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "gated", deploy: true });
  });

  it("does not deploy when every recent digest has audio", LONG, async () => {
    await seed(repo.root, {
      "state/last-run.json": publishedYesterday,
      "Digests/2026/10/2026-10-06.md": digestFile("2026-10-06", {
        url: "https://example.public.blob.vercel-storage.com/audio/2026-10-06.mp3",
        duration_ms: 240_000,
      }),
    });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "gated", deploy: false });
  });

  it("ignores a digest older than seven days without audio", LONG, async () => {
    await seed(repo.root, {
      "state/last-run.json": publishedYesterday,
      "Digests/2026/09/2026-09-20.md": digestFile("2026-09-20"),
    });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "gated", deploy: false });
  });

  it("asks for a deploy after a quiet day too", LONG, async () => {
    await seed(repo.root, { "Digests/2026/10/2026-10-06.md": digestFile("2026-10-06") });
    const world = makeWorld(repo.root, {
      now: WED,
      feeds: { "blog-a": sourceItems("blog-a", 1, "q") },
    });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing", deploy: true });
  });

  it("runs anyway with --force", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": publishedYesterday });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { force: true });
    expect(result.report).toMatchObject({
      outcome: "published",
      digests: [{ id: "2026-10-07", kind: "regular" }],
    });
  });

  it("runs anyway in on-demand mode", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": publishedYesterday });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { mode: "on-demand" });
    expect(result.report).toMatchObject({
      outcome: "published",
      digests: [{ id: "2026-10-07", kind: "on-demand" }],
    });
  });
});

describe("dry run", () => {
  it("writes no state, no digest and no commit", LONG, async () => {
    const before = head(repo.root);
    const world = makeWorld(repo.root, { now: WED });
    const results = await runStaged(world, { dryRun: true });
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(results[5]?.report).toMatchObject({
      outcome: "published",
      dry_run: true,
      deploy: false,
      commit: { status: "dry_run" },
    });
    expect(head(repo.root)).toBe(before);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
    for (const rel of [
      DIGEST_PATH,
      "state/seen.json",
      "state/judgments.json",
      "state/last-run.json",
      "state/source-health.json",
    ]) {
      expect(await exists(repo.root, rel)).toBe(false);
    }
  });

  it("leaves a digest preview under .cache only", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { dryRun: true });
    expect(result.report).toMatchObject({
      digests: [
        { id: "2026-10-07", preview: ".cache/run/2026-10-07/digest-preview.md", path: null },
      ],
    });
    const preview = await readDigest(repo.root, ".cache/run/2026-10-07/digest-preview.md");
    expect(preview.id).toBe("2026-10-07");
  });

  it("carries dry_run from the gate to later stages that get no flag", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate", dryRun: true });
    const fetch = await runStage(world, { stage: "fetch" });
    expect(fetch.report).toMatchObject({ stage: "fetch", dry_run: true });
    expect(await exists(repo.root, "state/source-health.json")).toBe(false);
  });

  it("does not ask for a deploy even when a digest lacks audio", LONG, async () => {
    await seed(repo.root, { "Digests/2026/10/2026-10-06.md": digestFile("2026-10-06") });
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { dryRun: true });
    expect(result.report).toMatchObject({ dry_run: true, deploy: false });
  });
});

describe("failed run", () => {
  async function stateSnapshot(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const rel of [
      "state/seen.json",
      "state/judgments.json",
      "state/last-run.json",
      DIGEST_PATH,
    ]) {
      out[rel] = await exists(repo.root, rel);
    }
    return out;
  }

  it("fails the judge stage when most items go unjudged, and touches no state", LONG, async () => {
    const feeds = {
      "blog-a": [
        ...sourceItems("blog-a", 2, "ok"),
        feedItem({ sourceId: "blog-a", slug: "s1", tag: "skip" }),
        feedItem({ sourceId: "blog-a", slug: "s2", tag: "skip" }),
        feedItem({ sourceId: "blog-a", slug: "s3", tag: "skip" }),
      ],
    };
    const before = head(repo.root);
    const world = makeWorld(repo.root, { now: WED, feeds });
    const result = await runStage(world);
    expect(result.code).toBe(1);
    expect(result.report).toMatchObject({
      outcome: "failed",
      stage: "judge",
      deploy: false,
      items: 0,
      digests: [],
    });
    expect(result.report).toHaveProperty("error");
    expect(await stateSnapshot()).toEqual({
      "state/seen.json": false,
      "state/judgments.json": false,
      "state/last-run.json": false,
      [DIGEST_PATH]: false,
    });
    expect(head(repo.root)).toBe(before);
  });

  it("fails the fetch stage when every source that could run failed", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    world.breakNetwork();
    const result = await runStage(world);
    expect(result.code).toBe(1);
    expect(result.report).toMatchObject({ outcome: "failed", stage: "fetch" });
  });

  it("keeps the window and seen list when a later run follows a failed one", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    world.breakNetwork();
    await runStage(world);
    expect(await exists(repo.root, "state/last-run.json")).toBe(false);

    const retry = makeWorld(repo.root, { now: new Date("2026-10-07T07:00:00Z") });
    const gate = await runStage(retry, { stage: "gate" });
    // No earlier fetch is recorded, so the window is the first-run default of three days.
    expect(gate.report).toMatchObject({
      passes: [{ window: { from: "2026-10-04T07:00:00.000Z" } }],
    });
  });

  it("refuses to commit a run whose stages did not finish", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate" });
    await runStage(world, { stage: "fetch" });
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.code).toBe(1);
    expect(commit.report).toMatchObject({ outcome: "failed", stage: "commit" });
    expect(JSON.stringify(commit.report)).toContain("validate stage has not run");
    expect(await stateSnapshot()).toMatchObject({ "state/seen.json": false });
  });

  it("refuses to commit when there is no plan at all", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.code).toBe(1);
    expect(JSON.stringify(commit.report)).toContain("No plan found");
  });

  it("names the missing earlier stage when a stage runs out of order", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate" });
    const write = await runStage(world, { stage: "write" });
    expect(write.code).toBe(1);
    expect(JSON.stringify(write.report)).toContain("the judge stage has not run");
  });

  it("records a source failure but still publishes when other sources answer", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    world.failSource("blog-b");
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published" });
    const health = await readJson<SourceHealthFile>(repo.root, "state/source-health.json");
    expect(health.sources["blog-b"]).toEqual({ failures: 1 });
    expect(health.sources["blog-a"]?.failures).toBe(0);
  });

  it("names the failed sources in the fetch report, ids only", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    world.failSource("blog-b");
    await runStage(world, { stage: "gate" });
    const fetch = await runStage(world, { stage: "fetch" });
    expect(fetch.report).toMatchObject({
      stage: "fetch",
      passes: [{ failed_sources: ["blog-b"], sources: { run: 3, ok: 2, failed: 1, skipped: 0 } }],
    });
  });
});

describe("Sunday: regular and weekly passes", () => {
  const regularYesterday = lastRunFile({
    regular: {
      at: "2026-10-09T05:13:00Z",
      outcome: "published",
      digest_id: "2026-10-09",
      items: 8,
    },
    last_fetch_at: "2026-10-09T05:13:00Z",
  });

  function sundayFeeds() {
    return {
      "blog-a": sourceItems("blog-a", 8, "a"),
      "blog-b": sourceItems("blog-b", 8, "b"),
      "journal-w": sourceItems("journal-w", 4, "j"),
    };
  }

  it("plans a regular pass and then a weekly pass", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": regularYesterday });
    const world = makeWorld(repo.root, { now: SUN });
    const gate = await runStage(world, { stage: "gate" });
    expect(gate.report).toMatchObject({
      due: true,
      passes: [
        { id: "2026-10-11", kind: "regular" },
        { id: "2026-10-11-weekly", kind: "weekly" },
      ],
    });
  });

  it("publishes both digests in one commit without repeating an item", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": regularYesterday });
    const world = makeWorld(repo.root, { now: SUN, feeds: sundayFeeds() });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published", deploy: true });
    const regular = await readDigest(repo.root, "Digests/2026/10/2026-10-11.md");
    const weekly = await readDigest(repo.root, "Digests/2026/10/2026-10-11-weekly.md");
    expect(regular.kind).toBe("regular");
    expect(weekly.kind).toBe("weekly");
    const regularIds = new Set(regular.items.map((item) => item.id));
    expect(weekly.items.some((item) => regularIds.has(item.id))).toBe(false);
    expect(weekly.items.length).toBeGreaterThanOrEqual(3);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe(
      "chore(digest): 2026-10-11, 2026-10-11-weekly",
    );
  });

  it("records both kinds and chains the cover", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": regularYesterday });
    const world = makeWorld(repo.root, { now: SUN, feeds: sundayFeeds() });
    await runStage(world);
    const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(lastRun.regular).toMatchObject({ outcome: "published", digest_id: "2026-10-11" });
    expect(lastRun.weekly).toMatchObject({ outcome: "published", digest_id: "2026-10-11-weekly" });
    const regular = await readDigest(repo.root, "Digests/2026/10/2026-10-11.md");
    const weekly = await readDigest(repo.root, "Digests/2026/10/2026-10-11-weekly.md");
    expect(weekly.cover.template).not.toBe(regular.cover.template);
    expect(lastRun.last_cover).toEqual({
      template: weekly.cover.template,
      palette: weekly.cover.palette,
    });
  });

  it("gives the weekly pass the seven day window and the weekly sources", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": regularYesterday });
    const world = makeWorld(repo.root, { now: SUN, feeds: sundayFeeds() });
    await runStage(world);
    const weeklyCalls = world.fetchCalls.filter((c) => c.from === "2026-10-04T05:13:00.000Z");
    expect(weeklyCalls.map((c) => c.source).sort()).toEqual([
      "blog-a",
      "blog-b",
      "blog-c",
      "journal-w",
    ]);
    const regularCalls = world.fetchCalls.filter((c) => c.from === "2026-10-09T05:13:00.000Z");
    expect(regularCalls.map((c) => c.source).sort()).toEqual(["blog-a", "blog-b", "blog-c"]);
  });

  it("does not repeat the weekly pass on the same Sunday", LONG, async () => {
    await seed(repo.root, { "state/last-run.json": regularYesterday });
    const world = makeWorld(repo.root, { now: SUN, feeds: sundayFeeds() });
    await runStage(world);
    world.setNow(new Date("2026-10-11T10:00:00Z"));
    const again = await runStage(world, { stage: "gate", force: true });
    expect(again.report).toMatchObject({ due: true, passes: [{ kind: "regular" }] });
    expect((again.report as { passes: unknown[] }).passes).toHaveLength(1);
  });

  it("runs only the weekly pass in weekly mode, on any day", LONG, async () => {
    const world = makeWorld(repo.root, {
      now: WED,
      feeds: {
        "journal-w": sourceItems("journal-w", 5, "j"),
        "blog-a": sourceItems("blog-a", 4, "a"),
      },
    });
    const result = await runStage(world, { mode: "weekly" });
    expect(result.report).toMatchObject({
      outcome: "published",
      digests: [{ id: "2026-10-07-weekly", kind: "weekly", outcome: "published" }],
    });
    const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");
    expect(lastRun.weekly).toMatchObject({ digest_id: "2026-10-07-weekly" });
    expect(lastRun.regular).toBeUndefined();
    expect(world.fetchCalls.some((c) => c.source === "journal-w")).toBe(true);
  });
});

describe("judgments cache", () => {
  it("uses state/judgments.json and asks the judge only about new items", LONG, async () => {
    const feeds = goodFeeds(8);
    const world = makeWorld(repo.root, { now: WED, feeds });
    const all = Object.values(feeds).flat();
    const cached = await world.judge.judge(all.slice(0, 5));
    world.judge.asked.length = 0;
    const file: JudgmentsFile = {
      version: 1,
      entries: Object.fromEntries(
        cached.map((entry) => [`${entry.item_id}:${entry.questions_hash}:${entry.model}`, entry]),
      ),
    };
    await seed(repo.root, { "state/judgments.json": json(file) });

    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published" });
    expect(world.judge.asked).toHaveLength(1);
    expect(world.judge.asked[0]).toHaveLength(3);
    const judged = await readJson<{ counts: { cache_hits: number; fresh: number } }>(
      repo.root,
      ".cache/run/2026-10-07/judged.json",
    );
    expect(judged.counts).toMatchObject({ cache_hits: 5, fresh: 3 });
  });

  it("resumes a judge stage without judging again", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStage(world, { stage: "gate" });
    await runStage(world, { stage: "fetch" });
    await runStage(world, { stage: "judge" });
    expect(world.judge.asked).toHaveLength(1);
    await runStage(world, { stage: "judge" });
    expect(world.judge.asked).toHaveLength(1);
  });

  it("prunes judgments older than 30 days when it persists them", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const stale = (await world.judge.judge([feedItem({ sourceId: "blog-a", slug: "old" })]))[0];
    if (!stale) throw new Error("expected a judgment");
    const old = { ...stale, judged_at: "2026-08-01T00:00:00Z" };
    const file: JudgmentsFile = {
      version: 1,
      entries: { [`${old.item_id}:${old.questions_hash}:${old.model}`]: old },
    };
    await seed(repo.root, { "state/judgments.json": json(file) });
    await runStage(world);
    const saved = await readJson<JudgmentsFile>(repo.root, "state/judgments.json");
    expect(Object.values(saved.entries).some((e) => e.item_id === old.item_id)).toBe(false);
    expect(Object.keys(saved.entries)).toHaveLength(8);
  });
});

describe("tech releases in a published run", () => {
  const OUTLETS = ["outlet-x", "outlet-y", "outlet-z"] as const;

  /** The registry with three consumer tech outlets beside the usual blogs. */
  async function seedTechSources(): Promise<void> {
    const file = sourcesFile();
    await seed(repo.root, {
      "config/sources.json": json({
        ...file,
        sources: [...file.sources, ...OUTLETS.map((id) => techSource(id))],
      }),
    });
  }

  /**
   * One tablet launch that all three outlets covered under different headlines, six launches
   * only one outlet carried, and a rumour.
   */
  function techFeeds() {
    return {
      "outlet-x": [
        techItem("outlet-x", "ipad", "Apple announces the iPad Pro with M5 chip", 3),
        techItem("outlet-x", "fairphone", "Fairphone 6 goes on sale in Europe", 2),
        techItem("outlet-x", "framework", "Framework Laptop 16 gets a new GPU module", 2),
        techItem("outlet-x", "rumour", "Acme Fold 3 rumour points to a spring launch", 0),
      ],
      "outlet-y": [
        techItem("outlet-y", "ipad", "M5 iPad Pro arrives with a faster GPU", 3),
        techItem("outlet-y", "garmin", "Garmin Fenix 9 adds satellite messaging", 2),
        techItem("outlet-y", "nothing", "Nothing Headphone 2 arrives with a metal frame", 2),
      ],
      "outlet-z": [
        techItem("outlet-z", "ipad", "Apple iPad Pro (M5) goes official", 3),
        techItem("outlet-z", "valve", "Valve Steam Deck 2 pre-orders open", 2),
        techItem("outlet-z", "rivian", "Rivian R3 production starts in Illinois", 2),
      ],
    };
  }

  it(
    "publishes five tech stories in their own section, merged across outlets, never as Top picks",
    LONG,
    async () => {
      await seedTechSources();
      const world = makeWorld(repo.root, { now: WED, feeds: { ...goodFeeds(8), ...techFeeds() } });
      const results = await runStaged(world);
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);

      // Fetch: ten tech items in, the three iPad headlines merged into one with its coverage.
      const pool = await readJson<{
        report: {
          dedupe: { story_clustered: number };
          prefilter: { kept: number; tech: { input: number; kept: number } };
        };
        items: Array<{ title: string; source_id: string; signals: { coverage?: number } }>;
      }>(repo.root, ".cache/run/2026-10-07/pool.json");
      expect(pool.report.dedupe.story_clustered).toBe(2);
      expect(pool.report.prefilter.tech).toMatchObject({ input: 8, kept: 8 });
      expect(pool.report.prefilter.kept).toBe(16);
      const ipad = pool.items.filter((item) => item.title.includes("iPad"));
      expect(ipad).toHaveLength(1);
      expect(ipad[0]?.signals.coverage).toBe(3);
      // Coverage ranks the tech pool, so the launch three outlets covered leads it.
      const techPool = pool.items.filter((item) => item.source_id.startsWith("outlet-"));
      expect(techPool[0]?.title).toContain("iPad");

      // The digest: eight craft items, plus five tech stories on top of them.
      const digest = await readDigest(repo.root, DIGEST_PATH);
      expect(digest.items).toHaveLength(13);
      const tech = digest.items.filter((item) => item.section === "tech");
      expect(tech).toHaveLength(5);
      expect(tech.every((item) => item.category === "consumer_tech_releases")).toBe(true);
      // The flagship launch (level 3) outranks the level 2 launches inside the section.
      expect(tech[0]?.headline).toContain("iPad Pro");
      expect(tech[0]?.score).toBe(0.7291);
      expect(tech.slice(1).every((item) => item.score === 0.6365)).toBe(true);
      expect(digest.items.some((item) => item.headline.includes("rumour"))).toBe(false);

      // Top picks are the three best items outside tech, and tech follows AI in the file.
      const top = digest.items.filter((item) => item.section === "top");
      expect(top).toHaveLength(3);
      expect(top.every((item) => item.category !== "consumer_tech_releases")).toBe(true);
      const sections = [...new Set(digest.items.map((item) => item.section))];
      expect(sections.indexOf("tech")).toBe(sections.indexOf("ai") + 1);
      const fileText = await readFile(join(repo.root, DIGEST_PATH), "utf8");
      expect(fileText.indexOf("## Tech releases")).toBeGreaterThan(
        fileText.indexOf("## AI models and products"),
      );
      expect(fileText).not.toContain("Why:");

      // What was written: seven launches cleared the bar, so two are over the tech allowance of
      // five, and the rumour is below the bar.
      const written = await readJson<{ dropped: Array<{ stage: string; reason: string }> }>(
        repo.root,
        ".cache/run/2026-10-07/written.json",
      );
      const reasons = written.dropped.map((d) => d.reason);
      expect(reasons.filter((reason) => reason.startsWith("over_tech_cap"))).toHaveLength(2);
      expect(reasons.filter((reason) => reason.startsWith("below_threshold"))).toHaveLength(1);
      expect(reasons.some((reason) => reason.startsWith("over_cap"))).toBe(false);

      // The stored judgments carry the launch scale for the next run to reuse.
      const judgments = await readJson<JudgmentsFile>(repo.root, "state/judgments.json");
      const scales = Object.values(judgments.entries)
        .map((entry) => entry.launch_scale)
        .filter((scale) => scale !== undefined);
      expect(scales.sort()).toEqual([0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.75]);
    },
  );

  it("publishes when only tech stories clear the bar, with no Top picks", LONG, async () => {
    await seedTechSources();
    const world = makeWorld(repo.root, { now: WED, feeds: techFeeds() });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published" });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items).toHaveLength(5);
    expect(digest.items.every((item) => item.section === "tech")).toBe(true);
  });

  it("stays quiet when the only tech news is a rumour", LONG, async () => {
    await seedTechSources();
    const feeds = {
      "outlet-x": [
        techItem("outlet-x", "rumour", "Acme Fold 3 rumour points to a spring launch", 0),
      ],
      "outlet-y": [techItem("outlet-y", "deal", "Acme Buds 2 drop to a record low price", 0)],
      "outlet-z": [techItem("outlet-z", "case", "Acme Phone 7 case lineup leaks", 0)],
    };
    const world = makeWorld(repo.root, { now: WED, feeds });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing" });
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
  });
});
