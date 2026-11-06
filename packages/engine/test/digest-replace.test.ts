import { rm } from "node:fs/promises";
import type { LastRunFile, Source } from "@singularity/core";
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
  sourcesFile,
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

describe("the narration voice", () => {
  // The bug it prevents: the audio job holds no config store and no schedule file (SEC-03, D296), so
  // the voice a user sets in Settings never reached stored audio. The run, which has it, writes it
  // into the digest.
  it("is copied from the schedule into the digest the run writes", LONG, async () => {
    await seed(repo.root, {
      "config/schedule.json": json({
        version: 1,
        hour: 7,
        cadence_days: 2,
        skip_topics: [],
        voice_id: "sched_v",
      }),
    });
    await runStaged(makeWorld(repo.root, { now: WED }));
    expect((await readDigest(repo.root, PATH)).voice_id).toBe("sched_v");
  });
});

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
      expect(first.regenerations).toBeUndefined();

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
      // The count the site stops at (D212) is carried by the file, so a second one makes two.
      expect(second.regenerations).toBe(1);
      expect(await exists(repo.root, `Digests/2026/10/${ID}-2.md`)).toBe(false);
      expect(await exists(repo.root, TIMELINE)).toBe(false);
      expect(git(repo.root, "log", "-1", "--format=%s")).toBe(`chore(digest): replace ${ID}`);
      // The Generate sheet's status route reads the on-demand record; the cadence and the fetch
      // window stay where they were.
      const after = await readJson<LastRunFile>(repo.root, "state/last-run.json");
      expect(after.on_demand).toMatchObject({ outcome: "published", digest_id: ID });
      expect(after.regular).toEqual(lastRun.regular);
      expect(after.last_fetch_at).toBe(lastRun.last_fetch_at);

      world.setNow(new Date(WED.getTime() + 4 * 3_600_000));
      await runStaged(world, { replace: ID });
      expect((await readDigest(repo.root, PATH)).regenerations).toBe(2);
    },
  );

  // The owner's rewrite of 2026-11-06 took 5.5 minutes, 2 min 12 s of it scraping again every
  // listing the run had already read, through Firecrawl at 6.5 s apart (D376).
  it("carries the stories its run gathered and reads no slow source again", LONG, async () => {
    const sources = sourcesFile();
    const tube: Source = {
      ...(sources.sources[0] as Source),
      id: "tube",
      type: "youtube",
      url: "https://www.youtube.com/@tube",
      feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCtubetubetubetubetubetu",
      options: { channel_id: "UCtubetubetubetubetubetu" },
    };
    await seed(repo.root, {
      "config/sources.json": json({ ...sources, sources: [...sources.sources, tube] }),
    });
    const world = makeWorld(repo.root, { now: WED });
    let tubeReads = 0;
    world.deps.fetch.fetchers = {
      ...world.deps.fetch.fetchers,
      youtube: async () => {
        tubeReads += 1;
        return [];
      },
    };
    await runStaged(world);
    expect(tubeReads).toBe(1);
    // Nothing new since: every story the rewrite can tell is one the run already gathered.
    world.feeds = {};
    world.setNow(new Date(WED.getTime() + 2 * 3_600_000));
    const results = await runStaged(world, { replace: ID });
    expect(results.at(-1)?.report).toMatchObject({ outcome: "published" });
    expect(tubeReads).toBe(1);
  });

  it("keeps the old digest when the replacement finds nothing", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await runStaged(world);
    // A rewrite past the carried pool's two days reads everything again, and here finds nothing.
    world.setNow(new Date(WED.getTime() + 49 * 3_600_000));
    world.feeds = {};
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
