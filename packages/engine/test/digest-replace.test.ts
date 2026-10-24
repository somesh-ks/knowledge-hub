import { rm } from "node:fs/promises";
import type { LastRunFile } from "@singularity/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  exists,
  instantiate,
  json,
  makeWorld,
  readDigest,
  readJson,
  runStage,
  runStaged,
  seed,
  type TestRepo,
  WED,
} from "./orchestrator-fixtures.js";

// Regenerate and Delete on a briefing that already exists (D104): the replacement keeps the digest's
// id and window, and the old files go in the commit that publishes the new one.
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

const ID = "2026-10-07";
const PATH = `Digests/2026/10/${ID}.md`;
const TIMELINE = `Digests/2026/10/${ID}.audio.json`;
const LONG = { timeout: 90_000 };

describe("replace a briefing", () => {
  it(
    "makes the same digest again over its own window, supersedes it in one commit and leaves the cadence alone",
    LONG,
    async () => {
      const world = makeWorld(repo.root, { now: WED });
      await runStaged(world);
      const first = await readDigest(repo.root, PATH);
      await seed(repo.root, { [TIMELINE]: json({ digest: ID }) }, "chore: audio");
      const lastRun = await readJson<LastRunFile>(repo.root, "state/last-run.json");

      // Two hours later the cadence says nothing is due; a replacement runs anyway.
      world.setNow(new Date(WED.getTime() + 2 * 3_600_000));
      const results = await runStaged(world, { replace: ID });
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(results[0]?.report).toMatchObject({
        due: true,
        passes: [{ id: ID, kind: "regular", window: { from: first.window.from } }],
      });
      expect(results[5]?.report).toMatchObject({
        outcome: "published",
        digests: [{ id: ID, outcome: "published" }],
      });

      // Same id (no -2), the old narration timeline is gone, one commit says so.
      const second = await readDigest(repo.root, PATH);
      expect(second.generated_at).not.toBe(first.generated_at);
      expect(await exists(repo.root, `Digests/2026/10/${ID}-2.md`)).toBe(false);
      expect(await exists(repo.root, TIMELINE)).toBe(false);
      expect(git(repo.root, "log", "-1", "--format=%s")).toBe(`chore(digest): replace ${ID}`);
      // The Generate sheet's status route reads the on-demand record; the cadence and the fetch
      // window stay where they were.
      const after = await readJson<LastRunFile>(repo.root, "state/last-run.json");
      expect(after.on_demand).toMatchObject({ outcome: "published", digest_id: ID });
      expect(after.regular).toEqual(lastRun.regular);
      expect(after.last_fetch_at).toBe(lastRun.last_fetch_at);
    },
  );

  it("keeps the old digest when the replacement finds nothing", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    world.feeds = {};
    world.setNow(new Date(WED.getTime() + 2 * 3_600_000));
    const results = await runStaged(world, { replace: ID });
    expect(results.at(-1)?.report).toMatchObject({ outcome: "nothing" });
    expect(await exists(repo.root, PATH)).toBe(true);
  });
});

describe("delete a briefing", () => {
  it("removes the digest and its timeline in one guarded commit", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    await seed(repo.root, { [TIMELINE]: json({ digest: ID }) }, "chore: audio");

    const result = await runStage(world, { delete: ID });
    expect(result.code).toBe(0);
    expect(await exists(repo.root, PATH)).toBe(false);
    expect(await exists(repo.root, TIMELINE)).toBe(false);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe(`chore(digest): remove ${ID}`);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("refuses a digest that does not exist", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const result = await runStage(world, { delete: "2026-01-01" });
    expect(result.code).toBe(1);
  });
});
