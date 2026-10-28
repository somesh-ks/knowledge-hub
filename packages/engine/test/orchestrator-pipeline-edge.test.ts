import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Item,
  itemId,
  type JudgmentsFile,
  type LastRunFile,
  type SeenFile,
} from "@singularity/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run as renderCommand } from "../src/commands/render.js";
import { run as validateCommand } from "../src/commands/validate.js";
import { firecrawlUsedSince } from "../src/cost/ledger.js";
import { Selection, WrittenFile } from "../src/curate/selectionFile.js";
import { PoolFile, writePool } from "../src/fetch/pool.js";
import type { Judge } from "../src/judge/types.js";
import { BudgetExceededError } from "../src/llm/errors.js";
import { collectHealth } from "../src/ops/health.js";
import { readPlan, writePlan } from "../src/run/plan.js";
import { SpendTracker } from "../src/run/spend.js";
import { groundingDropRecords } from "../src/run/validateStage.js";
import { markCopiedFromStore, SNAPSHOT_TRAILER } from "../src/store/configDocs.js";
import { captureStdout, fakeWriter, makeContext, okWritten } from "./curate-helpers.js";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  exists,
  feedItem,
  goodFeeds,
  head,
  instantiate,
  json,
  makeWorld,
  PatternJudge,
  readDigest,
  readJson,
  runStage,
  seed,
  sourceItems,
  sourcesFile,
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

  // The bug (2026-10-25 weekly): the gate copied the store's config over the files, and the commit
  // stage's early check, unlike the guard, never allowed them, so the run failed after its spend.
  it("commits the config the gate copied from the store, marked as a snapshot", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    await markCopiedFromStore(repo.root, true, true);
    await writeFile(join(repo.root, "config/queries.json"), '{"queries":[]}\n', "utf8");
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.code).toBe(0);
    expect(git(repo.root, "show", "--name-only", "--format=%B", "HEAD")).toContain(
      SNAPSHOT_TRAILER,
    );
    expect(git(repo.root, "show", "--name-only", "--format=", "HEAD")).toContain(
      "config/queries.json",
    );
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

// The bug (D209): a run generated ahead reads state/ from the checkout it made at job start, so a
// push made during its wait (an on-demand run's, a config commit) made its own push a rebase
// conflict on state/seen.json and lost the briefing. Config is read before the wait, so a category
// muted meanwhile cannot fail a briefing that was validated against the old one.
describe("a run that holds for its publish time", () => {
  it("commits on top of what was pushed meanwhile", LONG, async () => {
    const world = makeWorld(repo.root, { now: WED });
    await throughValidate(world);
    const plan = await readPlan(repo.root);
    if (!plan) throw new Error("the gate wrote no plan");
    await writePlan(repo.root, {
      ...plan,
      publish_at: new Date(WED.getTime() + 30 * 60_000).toISOString(),
    });
    world.deps.wait = async () => {
      git(repo.other, "pull", "-q", "origin", "main");
      const topics = await readJson<{ topics: object[] }>(repo.other, "config/topics.json");
      await seed(
        repo.other,
        {
          "state/seen.json": json({ version: 1, items: { "pushed-meanwhile": "2026-10-07" } }),
          "config/topics.json": json({
            ...topics,
            topics: topics.topics.map((topic) => ({ ...topic, never_publish: true })),
          }),
        },
        "chore(state): an on-demand run and a muted category",
      );
      world.setNow(new Date(WED.getTime() + 30 * 60_000));
    };
    const commit = await runStage(world, { stage: "commit" });
    expect(commit.report).toMatchObject({ outcome: "published", commit: { status: "pushed" } });
    const seen = JSON.parse(git(repo.remote, "show", "main:state/seen.json")) as SeenFile;
    expect(Object.keys(seen.items)).toContain("pushed-meanwhile");
    expect(Object.keys(seen.items).length).toBeGreaterThan(1);
    // The muted categories are the other writer's edit, kept.
    expect(git(repo.remote, "show", "main:config/topics.json")).toContain('"never_publish": true');
  });
});

// A job that died after the gate and before Commit (an install, a crash) recorded nothing, so
// health read the briefing before it as the last run: run_died alerted and nothing healed.
describe("a run that died before the commit stage", () => {
  it(
    "records failed for what was due, so health reports run_failed and not run_died",
    LONG,
    async () => {
      const world = makeWorld(repo.root, { now: WED });
      expect((await runStage(world, { stage: "gate" })).code).toBe(0);
      const recorded = await runStage(world, { recordFailed: true });
      expect(recorded.code).toBe(0);
      expect(git(repo.remote, "log", "-1", "--format=%s", "main")).toBe(
        "chore(state): run 2026-10-07 failed",
      );
      const report = await collectHealth({
        root: repo.root,
        now: new Date(WED.getTime() + 3_600_000),
        monthlyChars: 500_000,
        ceilingUsd: 50,
        site: null,
        runs: [
          {
            databaseId: 7,
            status: "completed",
            conclusion: "failure",
            createdAt: new Date(WED.getTime() - 60_000).toISOString(),
            displayTitle: "run",
          },
        ],
      });
      const faults = report.findings.filter((each) => each.severity === "fault");
      expect(faults.map((each) => each.code)).toContain("run_failed");
      expect(faults.map((each) => each.code)).not.toContain("run_died");
    },
  );

  // The ledger recorded a run only at its commit, so Firecrawl's weekly budget never counted
  // what a failed run spent (2026-10-24 review).
  it("puts what the failed run spent in the cost ledger", LONG, async () => {
    // Firecrawl's price, so the ledger can price the record.
    await seed(repo.root, {
      "config/prices.json": json({
        version: 1,
        as_of: "2026-10-21",
        prices: [
          {
            provider: "firecrawl",
            product: "*",
            units: { credits: { usd: 0.001, per: 1 } },
            as_of: "2026-10-21",
            confirmed: false,
          },
        ],
      }),
    });
    const world = makeWorld(repo.root, { now: WED });
    world.deps = { ...world.deps, spend: new SpendTracker() };
    expect((await runStage(world, { stage: "gate" })).code).toBe(0);
    const run = (await readPlan(repo.root))?.created_at as string;
    // A stage that died after three scrapes, saved as each stage saves its spend.
    const stage = new SpendTracker();
    await stage.begin(repo.root, run);
    for (let i = 0; i < 3; i++) stage.guard.takeScrape();
    await stage.save(repo.root);
    expect((await runStage(world, { recordFailed: true })).code).toBe(0);
    const day = 24 * 60 * 60 * 1000;
    const week = [new Date(WED.getTime() - day), new Date(WED.getTime() + day)] as const;
    expect(await firecrawlUsedSince(repo.root, ...week, "the next run")).toBe(3);
  });

  // A dry run made the paid calls of a real one and recorded none: 45 Claude calls on 2026-10-24
  // never reached the Costs page.
  it(
    "puts what a dry run spent in the cost ledger, in a commit of the ledger alone",
    LONG,
    async () => {
      await seed(repo.root, {
        "config/prices.json": json({
          version: 1,
          as_of: "2026-10-21",
          prices: [
            {
              provider: "firecrawl",
              product: "*",
              units: { credits: { usd: 0.001, per: 1 } },
              as_of: "2026-10-21",
              confirmed: false,
            },
          ],
        }),
      });
      const world = makeWorld(repo.root, { now: WED });
      world.deps = { ...world.deps, spend: new SpendTracker() };
      expect((await runStage(world, { stage: "gate", dryRun: true })).code).toBe(0);
      const run = (await readPlan(repo.root))?.created_at as string;
      const stage = new SpendTracker();
      await stage.begin(repo.root, run);
      for (let i = 0; i < 3; i++) stage.guard.takeScrape();
      await stage.save(repo.root);
      for (const name of ["fetch", "judge", "write", "validate", "commit"] as const) {
        expect((await runStage(world, { stage: name })).code).toBe(0);
      }
      expect(git(repo.remote, "log", "-1", "--format=%s", "main")).toBe(
        "chore(costs): dry run 2026-10-07",
      );
      expect(git(repo.remote, "show", "--name-only", "--format=", "main").trim()).toBe(
        "state/costs-2026-10.json",
      );
      const day = 24 * 60 * 60 * 1000;
      const week = [new Date(WED.getTime() - day), new Date(WED.getTime() + day)] as const;
      expect(await firecrawlUsedSince(repo.root, ...week, "the next run")).toBe(3);
    },
  );
});

describe("grounding and validation", () => {
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

  /**
   * A writer whose first `count` stories carry a claim the source does not support. Which stories
   * those are follows selection, so the test reads them back from `unsupported`.
   */
  function writerUnsupportedFirst(count: number) {
    const unsupported: string[] = [];
    const writer = fakeWriter({
      write: (material) => {
        if (unsupported.length >= count) return okWritten(material);
        unsupported.push(material.id);
        return {
          ...okWritten(material),
          summary: `UNSUPPORTED claim about springs. ${okWritten(material).summary}`,
        };
      },
    });
    return { writer, unsupported };
  }

  it("drops an item whose sentence the source does not support", LONG, async () => {
    const { writer, unsupported } = writerUnsupportedFirst(1);
    const world = makeWorld(repo.root, { now: WED, writer });
    const result = await runStage(world);
    const [firstId] = unsupported as [string];
    expect(result.report).toMatchObject({ outcome: "published", items: 5 });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items.map((item) => item.id)).not.toContain(firstId);
    expect(digest.verified).toBe(true);

    const written = WrittenFile.parse(
      await readJson(repo.root, ".cache/run/2026-10-07/written.json"),
    );
    expect(written.dropped).toContainEqual(
      expect.objectContaining({ id: firstId, stage: "grounding" }),
    );
    expect(written.items.every((entry) => entry.verified)).toBe(true);
  });

  // The 2026-10-27 daily lost 5 of 8 stories to grounding and its cache was gone: nobody could say
  // which sentences failed or how much source text the check had.
  it(
    "names a grounding-dropped story, its source text length and its failing sentence",
    LONG,
    async () => {
      const { writer, unsupported } = writerUnsupportedFirst(1);
      const world = makeWorld(repo.root, { now: WED, writer });
      await runStage(world);
      const [firstId] = unsupported as [string];
      const report = (await readJson(repo.root, ".cache/run/2026-10-07/validate-report.json")) as {
        grounding_drops: Array<{
          id: string;
          source_chars: number;
          text_from: string;
          sentences: string[];
          repairs: number;
        }>;
      };
      expect(report.grounding_drops).toHaveLength(1);
      const [drop] = report.grounding_drops as [(typeof report.grounding_drops)[number]];
      expect(drop.id).toBe(firstId);
      expect(drop.source_chars).toBeGreaterThan(0);
      expect(drop.text_from).not.toBe("missing");
      expect(drop.sentences[0]).toContain("UNSUPPORTED claim about springs");
      expect(drop.repairs).toBe(0);
    },
  );

  // A rewrite that breaks the voice rules drops the story, but the claim that triggered the repair
  // is what the owner needs in the log, not only the lint messages.
  it("keeps the unsupported sentence of a story dropped for its voice", () => {
    const [record] = groundingDropRecords(
      [
        {
          id: "a",
          reason: "voice",
          unsupported: [
            {
              field: "summary",
              sentence: "The claim nobody supports.",
              score: 0.1,
              status: "unsupported",
            },
          ],
          violations: [{ field: "summary", rule: "banned_word", message: "Avoid a banned word." }],
          repairs: 1,
        },
      ],
      new Map(),
      new Map(),
      () => "src",
    );
    expect(record?.sentences).toEqual(["The claim nobody supports."]);
    expect(record?.voice_violations).toEqual(["Avoid a banned word."]);
  });

  const SCHEDULE_3_MINUTES = json({
    version: 1,
    hour: 7,
    cadence_days: 2,
    length_minutes: 3,
    skip_topics: [],
    weekly: { skip_topics: [] },
  });

  /** The validate stage's report for the day's pass. */
  const validateReport = (): Promise<Record<string, unknown>> =>
    readJson(repo.root, ".cache/run/2026-10-07/validate-report.json");

  // The 2026-10-15 daily chose 14 stories for five minutes and aired 4: every story lost after
  // selection came off the owner's length.
  it("fills the owner's length with a spare when grounding drops a story", LONG, async () => {
    await seed(repo.root, { "config/schedule.json": SCHEDULE_3_MINUTES });
    const feeds = manyOutlets(45);
    const { writer, unsupported } = writerUnsupportedFirst(3);
    const world = makeWorld(repo.root, { now: WED, feeds, writer });
    const result = await runStage(world);
    // Three minutes is eight stories at the narration's pace.
    expect(result.report).toMatchObject({ outcome: "published", items: 12 });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items.some((item) => unsupported.includes(item.id))).toBe(false);
    // The spares filled it, so no replacement was written.
    expect(await validateReport()).toMatchObject({ refill_written: 0 });
  });

  /**
   * Feeds of `count` stories, each from an outlet of its own, so the two-per-outlet cap leaves
   * selection more qualifying stories than a three-minute briefing writes.
   */
  function manyOutlets(count: number): Record<string, Item[]> {
    const feeds = goodFeeds(count, "wide");
    for (const items of Object.values(feeds)) {
      items.forEach((item, index) => {
        const url = `https://${item.source_id}-${index}.example/${item.id}`;
        items[index] = { ...item, id: itemId(url), url, canonical_url: url };
      });
    }
    return feeds;
  }

  type RefillMode = "ok" | "unsupported" | "throw";

  /**
   * A writer that cuts every story but the first `keep` it is given: with an unsupported claim
   * (grounding drops it in validation) or an em dash (the write stage's voice check drops it).
   */
  function writerKeeping(keep: number, cut: "grounding" | "voice" = "grounding") {
    let seen = 0;
    let refill: RefillMode | null = null;
    const writer = fakeWriter({
      write: (material) => {
        seen += 1;
        const ok = okWritten(material);
        if (refill === "throw") throw new BudgetExceededError(400_000, 399_000, 2_000);
        const bad = refill === null ? seen > keep : refill === "unsupported";
        if (!bad) return ok;
        return cut === "voice" && refill === null
          ? { ...ok, summary: `${ok.summary} It ships \u2014 today.` }
          : { ...ok, summary: `UNSUPPORTED claim about springs. ${ok.summary}` };
      },
    });
    const calls = { write: 0, airing: [] as string[] };
    const write = writer.write.bind(writer);
    writer.write = async (items, feedback, taste, airing) => {
      calls.write += 1;
      calls.airing.push(...(airing ?? []));
      return write(items, feedback, taste);
    };
    return {
      writer,
      calls,
      /** From here on the writer is telling validation's replacements. */
      startRefill: (mode: RefillMode) => {
        refill = mode;
        calls.write = 0;
        calls.airing = [];
      },
    };
  }

  /** Every stage as the workflow runs it, with validate run `validateRuns` times. */
  async function stagedWithRefill(
    world: ReturnType<typeof makeWorld>,
    startRefill: () => void,
    validateRuns = 1,
  ): Promise<{ write: unknown; validate: unknown }> {
    let write: unknown;
    for (const stage of ["gate", "fetch", "judge", "write"] as const) {
      const result = await runStage(world, { stage });
      expect(result.code).toBe(0);
      write = result.report;
    }
    startRefill();
    let validate: unknown;
    for (let run = 0; run < validateRuns; run++) {
      const result = await runStage(world, { stage: "validate" });
      expect(result.code).toBe(0);
      validate = result.report;
    }
    expect((await runStage(world, { stage: "commit" })).code).toBe(0);
    return { write, validate };
  }

  /** A three-minute briefing whose feeds give selection more stories than it writes. */
  async function seedWide(): Promise<void> {
    await seed(repo.root, {
      "config/schedule.json": SCHEDULE_3_MINUTES,
      "config/sources.json": json({
        ...sourcesFile(),
        sources: sourcesFile().sources.map((entry) => ({
          ...entry,
          options: { pool_cap: "20" },
        })),
      }),
    });
  }

  // The 2026-10-24 daily wrote 14 stories for five minutes, grounding and validation cut 7, and
  // it aired 3.0 minutes: nothing replaced a story cut after the write stage.
  it(
    "a briefing whose validation cuts most of its stories is topped up from the reserve, once",
    LONG,
    async () => {
      await seedWide();
      const { writer, calls, startRefill } = writerKeeping(2);
      const world = makeWorld(repo.root, { now: WED, feeds: manyOutlets(45), writer });
      let writtenFirst = 0;
      // Validate runs twice, as a re-run of the step would: the replacements keep their source.
      await stagedWithRefill(
        world,
        () => {
          writtenFirst = writer.materials.length;
          startRefill("ok");
        },
        2,
      );
      // Two stories survived the write stage's grounding: below the floor, nothing would air.
      expect(await exists(repo.root, DIGEST_PATH)).toBe(true);
      const digest = await readDigest(repo.root, DIGEST_PATH);
      expect(digest.items.length).toBeGreaterThanOrEqual(4);
      const refilled = writer.materials.slice(writtenFirst).map((m) => m.id);
      expect(digest.items.some((item) => refilled.includes(item.id))).toBe(true);
      // One round over both validate runs: one more request to the writer, none of it a story
      // written before, told the headlines already airing.
      expect(calls.write).toBe(1);
      expect(calls.airing).toHaveLength(2);
      const before = new Set(writer.materials.slice(0, writtenFirst).map((m) => m.id));
      expect(refilled.some((id) => before.has(id))).toBe(false);
    },
  );

  // A re-run of validate after that refill once marked the pass "nothing" while its selection,
  // which the commit publishes, held the refilled stories (2026-10-24 review).
  it("refills a sized briefing the write stage left under the floor", LONG, async () => {
    await seedWide();
    const { writer, calls, startRefill } = writerKeeping(2, "voice");
    const world = makeWorld(repo.root, { now: WED, feeds: manyOutlets(45), writer });
    const stages = await stagedWithRefill(world, () => startRefill("ok"), 2);
    // Its losses are in the stage JSON, by stage and reason (the artifact is out of reach).
    expect(stages.write).toMatchObject({
      passes: [{ outcome: "nothing", lost: { voice: expect.any(Number) } }],
    });
    expect(stages.validate).toMatchObject({ passes: [{ outcome: "selected" }] });
    expect(calls.write).toBe(1);
    expect((await readDigest(repo.root, DIGEST_PATH)).items.length).toBeGreaterThanOrEqual(3);
  });

  // The 2026-10-27 daily (owner's structure, five minutes): section counts held selection to 8
  // stories, grounding cut 5, and the reserve was empty because it was chosen under the same
  // counts, so nothing replaced them and 3 stories aired (79 s).
  it("refills from spares the structure's section counts would not have chosen", LONG, async () => {
    const section = (id: string, max: number) => ({
      type: "section",
      id,
      depth: "brief",
      max_stories: max,
    });
    await seed(repo.root, {
      "config/schedule.json": json({
        version: 1,
        hour: 7,
        cadence_days: 2,
        length_minutes: 5,
        skip_topics: [],
        weekly: { skip_topics: [] },
      }),
      "config/structure.json": json({
        version: 1,
        profile: "custom",
        blocks: [
          { type: "hello" },
          { type: "top_picks", stories: 3, depth: "deep" },
          section("design", 3),
          section("ui-craft", 3),
          section("ai", 2),
          section("tech", 2),
          { type: "trending", stories: 2 },
          section("software", 2),
          { type: "release_news", stories: 1 },
          { type: "sign_off" },
        ],
      }),
      "config/sources.json": json({
        ...sourcesFile(),
        sources: sourcesFile().sources.map((entry) => ({
          ...entry,
          options: { pool_cap: "20" },
        })),
      }),
    });
    const { writer, startRefill } = writerKeeping(3);
    const world = makeWorld(repo.root, { now: WED, feeds: manyOutlets(45), writer });
    const stages = await stagedWithRefill(world, () => startRefill("ok"));
    const [pass] = (stages.write as { passes: Array<{ selected: number }> }).passes;
    // Selection stays under the structure's counts, and grounding cuts all but three.
    expect(pass?.selected).toBeLessThan(12);
    const report = await validateReport();
    expect(report.grounding_dropped).toBeGreaterThanOrEqual(3);
    expect(report.refill_written).toBeGreaterThan(0);
    expect((await readDigest(repo.root, DIGEST_PATH)).items.length).toBeGreaterThanOrEqual(10);
  });

  it(
    "publishes what validates when the replacements are cut too, without a second round",
    LONG,
    async () => {
      await seedWide();
      const { writer, calls, startRefill } = writerKeeping(3);
      const world = makeWorld(repo.root, { now: WED, feeds: manyOutlets(45), writer });
      await stagedWithRefill(world, () => startRefill("unsupported"));
      expect(calls.write).toBe(1);
      expect(await validateReport()).toMatchObject({ refill_kept: 0 });
      expect((await readDigest(repo.root, DIGEST_PATH)).items).toHaveLength(3);
    },
  );

  // A refill is best effort: the run's token budget ending mid-refill once discarded a briefing
  // that had already validated (2026-10-24 review).
  it("publishes the validated stories when the refill hits the token budget", LONG, async () => {
    await seedWide();
    const { writer, startRefill } = writerKeeping(3);
    const world = makeWorld(repo.root, { now: WED, feeds: manyOutlets(45), writer });
    await stagedWithRefill(world, () => startRefill("throw"));
    expect((await readDigest(repo.root, DIGEST_PATH)).items).toHaveLength(3);
    expect(await validateReport()).toMatchObject({
      refill_written: 0,
      refill_error: expect.stringContaining("Token budget"),
    });
  });

  // A 15-minute briefing writes spares past the digest's 48 stories; with nothing dropped, the
  // validate stage built a digest of every survivor and failed the schema (2026-10-18 review).
  it("airs at most the digest's cap when more spares survive than it holds", LONG, async () => {
    await seed(repo.root, {
      "config/schedule.json": json({
        version: 1,
        hour: 7,
        cadence_days: 2,
        length_minutes: 15,
        skip_topics: [],
        weekly: { skip_topics: [] },
      }),
      // Each blog may send 40 stories, so the 90 written ones reach the judge.
      "config/sources.json": json({
        ...sourcesFile(),
        sources: sourcesFile().sources.map((entry) => ({ ...entry, options: { pool_cap: "40" } })),
      }),
    });
    const world = makeWorld(repo.root, { now: WED, feeds: goodFeeds(90) });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "published" });
    const digest = await readDigest(repo.root, DIGEST_PATH);
    expect(digest.items.length).toBeLessThanOrEqual(48);
  });

  it("re-checks the floor after grounding and records a quiet day", LONG, async () => {
    const feeds = { "blog-a": goodFeeds(8)["blog-a"] as Item[] };
    const ids = feeds["blog-a"].slice(0, 2).map((item) => item.id);
    const world = makeWorld(repo.root, { now: WED, feeds, writer: writerUnsupportedFor(ids) });
    const result = await runStage(world);
    expect(result.report).toMatchObject({ outcome: "nothing", items: 0 });
    expect(await exists(repo.root, DIGEST_PATH)).toBe(false);
    const seen = await readJson<SeenFile>(repo.root, "state/seen.json");
    expect(Object.keys(seen.items)).toHaveLength(0);
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
    expect(JSON.parse(rendered.stdout)).toMatchObject({ outcome: "dry-run", items: 6 });

    await runStage(world, { stage: "commit" });
    const validated = await captureStdout(() =>
      validateCommand([DIGEST_PATH, "--pool", ".cache/run/2026-10-07/pool.json"], ctx),
    );
    expect(validated.result).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({ ok: true, errors: 0 });
  });

  it("writes a pool in the format singularity fetch writes", LONG, async () => {
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

describe("a blocked domain", () => {
  it("never reaches the judge, even from open search", LONG, async () => {
    const hit = (host: string, slug: string): Item => {
      const url = `https://${host}/${slug}`;
      return {
        ...feedItem({ sourceId: "open-search", slug }),
        id: itemId(url),
        url,
        canonical_url: url,
        source_type: "exa",
      };
    };
    const blocked = hit("news.blocked-outlet.example", "story");
    const allowed = hit("fine-outlet.example", "story");
    const world = makeWorld(repo.root, { now: WED, feeds: goodFeeds(4) });
    world.deps.fetch.fetchers = {
      ...world.deps.fetch.fetchers,
      exa: async () => [blocked, allowed],
    };
    await seed(repo.root, {
      "config/sources.json": json({
        version: 1,
        sources: [
          ...sourcesFile().sources,
          {
            id: "open-search",
            name: "Open search",
            type: "exa",
            url: "https://exa.ai/",
            feed_url: null,
            tier: "daily",
            high_signal: true,
            enabled: true,
            failures: 0,
            options: {},
          },
        ],
      }),
      "config/profiles/owner.json": json({
        user_id: "owner",
        blocked_domains: ["blocked-outlet.example"],
        votes: [],
      }),
    });
    for (const stage of ["gate", "fetch", "judge"] as const) {
      expect((await runStage(world, { stage })).code).toBe(0);
    }
    const asked = world.judge.asked.flat();
    expect(asked).toContain(allowed.id);
    expect(asked).not.toContain(blocked.id);
  });
});

describe("story votes", () => {
  const vote = (n: number) => ({
    story_id: `s${n}`,
    url: `https://blog-a.example/old-${n}`,
    headline: `Old ${n}`,
    domain: "blog-a.example",
    topic: "design",
    source_id: "blog-a",
    value: "down",
    at: "2026-10-05T00:00:00Z",
  });

  // Two items equal in every way but their source, which the owner voted down 2 or 3 times.
  it.each([
    [2, "ranks the same"],
    [3, "ranks lower"],
  ])("with %s down votes on a source, its item %s", LONG, async (count, outcome) => {
    const feeds = goodFeeds(4);
    feeds["blog-a"] = [...(feeds["blog-a"] ?? []), feedItem({ sourceId: "blog-a", slug: "probe" })];
    feeds["blog-b"] = [...(feeds["blog-b"] ?? []), feedItem({ sourceId: "blog-b", slug: "probe" })];
    await seed(repo.root, {
      "config/profiles/owner.json": json({
        user_id: "owner",
        blocked_domains: [],
        votes: Array.from({ length: count }, (_, i) => vote(i)),
      }),
    });
    const world = makeWorld(repo.root, { now: WED, feeds });
    expect((await runStage(world)).code).toBe(0);
    const items = (await readDigest(repo.root, DIGEST_PATH)).items;
    const score = (host: string): number | undefined =>
      items.find((item) => item.url === `https://${host}.example/probe`)?.score;
    expect(score("blog-b")).toBeDefined();
    if (outcome === "ranks lower") expect(score("blog-a")).toBeLessThan(score("blog-b") as number);
    else expect(score("blog-a")).toBe(score("blog-b"));
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
    expect(Object.keys(seen.items)).toHaveLength(0);
    const judgments = await readJson<JudgmentsFile>(repo.root, "state/judgments.json");
    expect(Object.values(judgments.entries).map((e) => e.item_id)).not.toContain(
      itemId("https://blog-a.example/retry-me"),
    );
  });
});
