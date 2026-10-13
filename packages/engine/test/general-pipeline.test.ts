import { rm } from "node:fs/promises";
import {
  Item,
  itemId,
  resolveTopics,
  type Source,
  type SourceStatsFile,
  TopicsFile,
} from "@dispatch/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolFile } from "../src/fetch/pool.js";
import { GeneralJudge } from "../src/judge/generalJudge.js";
import type { JudgedFile } from "../src/run/artifacts.js";
import { gatherPool } from "../src/run/gatherPool.js";
import { type GeneralJudgedFile, GeneralPoolFile } from "../src/run/generalNews.js";
import { serializeTopics } from "../src/topics/store.js";
import {
  buildTemplate,
  exists,
  goodFeeds,
  instantiate,
  json,
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
  WED,
} from "./orchestrator-fixtures.js";
import { realPreferences } from "./score-factories.js";
import { NO_WAIT } from "./write-fakes.js";

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
const RUN = ".cache/run/2026-10-07";
const DIGEST_PATH = "Digests/2026/10/2026-10-07.md";

function generalSource(id: string, host: string, topic: string): Source {
  return {
    id,
    name: id,
    type: "rss",
    url: `https://${host}.example/${topic}`,
    feed_url: `https://${host}.example/${topic}/feed.xml`,
    tier: "daily",
    high_signal: false,
    enabled: true,
    failures: 0,
    options: {},
    origin: "seed",
    topic_ids: [topic],
  };
}

const GENERAL_SOURCES = [
  generalSource("npr-world", "npr", "world"),
  generalSource("bbc-world", "bbc", "world"),
  generalSource("npr-business", "npr", "business"),
];

function registry(): string {
  const base = sourcesFile();
  return json({ ...base, sources: [...base.sources, ...GENERAL_SOURCES] });
}

function story(
  sourceId: string,
  topic: string,
  slug: string,
  title: string,
  snippet = "A report.",
  url = `https://${sourceId}.example/${slug}`,
): Item {
  return Item.parse({
    id: itemId(url),
    url,
    canonical_url: url,
    title,
    source_id: sourceId,
    source_type: "rss",
    published_at: "2026-10-06T08:00:00Z",
    fetched_at: "2026-10-07T05:00:00Z",
    snippet,
    topic_ids: [topic],
  });
}

const QUAKE_NPR = "Magnitude 6.1 earthquake strikes Izmir coast in Turkey";
const QUAKE_BBC = "Earthquake of magnitude 6.1 strikes Izmir coast, Turkey";

/** Twelve world stories only NPR carried, with headlines that share nothing to cluster on. */
const ALONE = Array.from({ length: 12 }, (_, n) => [
  `solo-${n}`,
  `Zorblax${n} delegation inspects Quillon${n} harbour`,
]);

function worldFeeds(): Record<string, Item[]> {
  const feeds = goodFeeds(8);
  const shared = "https://blog-a.example/shared-story";
  feeds["blog-a"] = [
    ...(feeds["blog-a"] ?? []),
    // The briefing's copy of a story a general feed carries too: same address, same item id.
    Item.parse({
      id: itemId(shared),
      url: shared,
      canonical_url: shared,
      title: "Shared design story about interface craft",
      source_id: "blog-a",
      source_type: "rss",
      published_at: "2026-10-06T08:00:00Z",
      fetched_at: "2026-10-07T05:00:00Z",
      snippet: "judge:design_engineering_craft",
    }),
  ];
  feeds["npr-world"] = [
    story("npr-world", "world", "quake", QUAKE_NPR),
    ...ALONE.map(([slug, title]) => story("npr-world", "world", slug as string, title as string)),
    story("npr-world", "world", "hype", "Zorblax hype Quillon miracle claims", "hype:0.9 offtopic"),
    story(
      "npr-world",
      "world",
      "shared",
      "Shared design story about interface craft",
      "A report.",
      shared,
    ),
  ];
  feeds["bbc-world"] = [story("bbc-world", "world", "quake", QUAKE_BBC)];
  feeds["npr-business"] = [
    story("npr-business", "business", "marlow", "Retailer Marlow reports quarterly profit rise"),
  ];
  return feeds;
}

/** A Jev stand-in for the general stories: a fit question and the two flags, nothing else. */
function generalJev() {
  const asked: string[][] = [];
  const client = {
    async systemOne(request: { state: unknown; questions: Record<string, unknown> }) {
      const keys = Object.keys(request.questions);
      asked.push(keys);
      const state = request.state as { snippet: string };
      const hype = /hype:([0-9.]+)/.exec(state.snippet)?.[1];
      const level = /offtopic/.test(state.snippet) ? 0 : 4;
      return {
        model: "jev-test",
        answers: Object.fromEntries(
          keys.map((key) => [
            key,
            key === "hype"
              ? { type: "noul", noul: Number(hype ?? 0) }
              : key === "sponsored"
                ? { type: "noul", noul: 0 }
                : { type: "score", score: level },
          ]),
        ),
      };
    },
  };
  return { asked, judge: new GeneralJudge({ client, now: () => WED, retry: NO_WAIT }) };
}

describe("a run with general news feeds", () => {
  it(
    "judges every story with the topic question and the trust flags, and publishes none of them",
    LONG,
    async () => {
      await seed(repo.root, { "config/sources.json": registry() });
      const jev = generalJev();
      const world = makeWorld(repo.root, {
        now: WED,
        feeds: worldFeeds(),
        generalJudge: jev.judge,
      });

      const results = await runStaged(world);
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);

      // Sixteen distinct stories: the quake (two outlets, one story), twelve single-outlet ones,
      // the hype one, the shared one and Marlow. All asked, far past the 8 a source normally gets.
      const general = GeneralPoolFile.parse(await readJson(repo.root, `${RUN}/general.json`));
      expect(general.items).toHaveLength(16);
      expect(jev.asked).toHaveLength(16);
      // Only the fit question and the two flags: no category, craft or launch question.
      expect(jev.asked.every((keys) => keys.join() === "hype,sponsored,fit_0")).toBe(true);
      expect(results[2]?.report).toMatchObject({
        passes: [{ general_pool: 16, general_judged: 16, general_requests: 16 }],
      });
      expect(results[1]?.report).toMatchObject({ passes: [{ general_stories: 16 }] });

      // The stories are not in the pool, so nothing can select them.
      const pool = await readJson<PoolFile>(repo.root, `${RUN}/pool.json`);
      const poolIds = new Set(pool.items.map((item) => item.id));
      const onlyGeneral = general.items.filter((item) => item.source_id !== "blog-a");
      const shared = general.items.find((item) => item.url.endsWith("shared-story"));
      expect(shared).toBeDefined();
      for (const item of general.items) {
        // The one id both lists hold is the shared story, whose briefing copy is a blog-a item.
        if (item.id !== shared?.id) expect(poolIds.has(item.id), item.title).toBe(false);
      }
      expect(onlyGeneral.length).toBeGreaterThan(0);
      const briefingCopy = pool.items.find((item) => item.id === shared?.id);
      expect(briefingCopy?.source_id).toBe("blog-a");
      expect(briefingCopy?.topic_ids).toBeUndefined();

      const judged = await readJson<JudgedFile>(repo.root, `${RUN}/judged.json`);
      expect(judged.entries.every((entry) => poolIds.has(entry.item_id))).toBe(true);
      expect(await exists(repo.root, `${RUN}/general-judged.json`)).toBe(true);
      const digest = await readDigest(repo.root, DIGEST_PATH);
      const published = new Set(digest.items.map((item) => item.id));
      for (const item of general.items) {
        if (item.id !== shared?.id) expect(published.has(item.id), item.title).toBe(false);
      }
      expect(digest.items.every((item) => item.section !== "general")).toBe(true);
      const selection = await readJson<{ items: { id: string }[] }>(
        repo.root,
        `${RUN}/selection.json`,
      );
      expect(selection.items.every((item) => poolIds.has(item.id))).toBe(true);

      // The feeds' counters: fetched, judged, passed, asked, flagged and covered; never published.
      const counts = await readJson<{ sources: Record<string, Record<string, number>> }>(
        repo.root,
        `${RUN}/source-counts.json`,
      );
      expect(counts.sources["npr-world"]).toEqual({
        fetched: 15,
        judged: 15,
        passed: 14,
        asked: 15,
        flagged: 1,
        covered: 1,
      });
      expect(counts.sources["bbc-world"]).toEqual({
        fetched: 1,
        judged: 1,
        passed: 1,
        asked: 1,
        flagged: 0,
        covered: 1,
      });
      const stats = await readJson<SourceStatsFile>(repo.root, "state/source-stats.json");
      expect(stats.sources["npr-world"]).toMatchObject({
        fetched: 15,
        judged: 15,
        passed: 14,
        asked: 15,
        flagged: 1,
        covered: 1,
        published: 0,
      });
      expect(stats.sources["npr-business"]).toMatchObject({ judged: 1, covered: 0, published: 0 });
      expect(stats.sources["blog-a"]).not.toHaveProperty("covered");

      // The quake story was judged once, for both outlets that carried it.
      const file = await readJson<GeneralJudgedFile>(repo.root, `${RUN}/general-judged.json`);
      expect(file.entries).toHaveLength(16);
      expect(file.counts).toMatchObject({ judged: 16, unjudged: 0, over_ceiling: 0 });
    },
  );

  it("still runs the briefing when judging the general stories breaks", LONG, async () => {
    await seed(repo.root, { "config/sources.json": registry() });
    const broken = generalJev().judge;
    broken.judge = async () => {
      throw new Error("Jev is down");
    };
    const world = makeWorld(repo.root, { now: WED, feeds: worldFeeds(), generalJudge: broken });
    expect((await runStaged(world)).map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await exists(repo.root, `${RUN}/general-judged.json`)).toBe(false);
  });

  it(
    "skips the stories with a warning, and still runs, when there is no Jev client",
    LONG,
    async () => {
      await seed(repo.root, { "config/sources.json": registry() });
      const world = makeWorld(repo.root, { now: WED, feeds: worldFeeds() });
      expect((await runStaged(world)).map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(await exists(repo.root, `${RUN}/general-judged.json`)).toBe(false);
      const stats = await readJson<SourceStatsFile>(repo.root, "state/source-stats.json");
      // Fetched is counted, nothing was judged, so the quality part has nothing to read yet.
      expect(stats.sources["npr-world"]).toMatchObject({ fetched: 15, judged: 0, published: 0 });
    },
  );
});

describe("gathering the pool", () => {
  it(
    "leaves the general feeds out of the weekly pass and out of the briefing's caps",
    LONG,
    async () => {
      await seed(repo.root, { "config/sources.json": registry() });
      const world = makeWorld(repo.root, { now: WED, feeds: worldFeeds() });
      const input = {
        root: repo.root,
        now: WED,
        id: "2026-10-07",
        window: { from: new Date("2026-10-05T05:13:00Z"), to: WED },
        setup: world.deps.fetch,
      };
      const regular = await gatherPool({ ...input, kind: "regular" });
      expect(regular.general?.items).toHaveLength(16);
      // The briefing pool never sees a general source's items, whatever the caps leave.
      expect(regular.pool.items.some((i) => i.source_id.startsWith("npr-"))).toBe(false);

      // A switched-off general feed is read only when the scoring sample asks for its weekly check
      // (D70), and its stories join the general stories, never the pool.
      const off = { ...(GENERAL_SOURCES[0] as Source), id: "world-top", enabled: false };
      world.feeds["world-top"] = [story("world-top", "world", "top-1", "A top story abroad")];
      await seed(repo.root, {
        "config/sources.json": json({
          ...sourcesFile(),
          sources: [...sourcesFile().sources, ...GENERAL_SOURCES, off],
        }),
      });
      const unchecked = await gatherPool({ ...input, kind: "regular" });
      expect(unchecked.general?.items.some((i) => i.source_id === "world-top")).toBe(false);
      const checked = await gatherPool({ ...input, kind: "regular", probeGeneral: [off] });
      expect(checked.general?.items.some((i) => i.source_id === "world-top")).toBe(true);
      expect(checked.pool.items.some((i) => i.source_id === "world-top")).toBe(false);
      expect(checked.results.find((r) => r.source_id === "world-top")?.ok).toBe(true);

      world.fetchCalls.length = 0;
      const weekly = await gatherPool({ ...input, kind: "weekly" });
      expect(weekly.general).toBeNull();
      expect(world.fetchCalls.map((c) => c.source).some((id) => /^(npr|bbc)-/.test(id))).toBe(
        false,
      );
    },
  );
});

// If a ticked general topic stops reaching the daily or weekly briefing, or an unticked one leaks
// in, the owner's World choice does nothing. A forced Sunday run makes both passes.
describe("general topics in the daily and weekly briefings", () => {
  const GENERAL = ["world", "business", "science", "culture", "sports"];
  const world = (slug: string, id: string, title: string, at: string) => ({
    ...story(id, "world", slug, title),
    published_at: at,
  });

  function sundayFeeds(): Record<string, Item[]> {
    const feeds: Record<string, Item[]> = {
      "blog-a": sourceItems("blog-a", 8, "a"),
      "blog-b": sourceItems("blog-b", 8, "b"),
    };
    feeds["npr-world"] = [
      world(
        "quake",
        "npr-world",
        "Magnitude 6.1 earthquake strikes Izmir coast in Turkey",
        "2026-10-10T08:00:00Z",
      ),
      world(
        "storm",
        "npr-world",
        "Typhoon Haikui batters Taiwan east coast and forces evacuations",
        "2026-10-07T08:00:00Z",
      ),
      world(
        "etna",
        "npr-world",
        "Volcano Etna erupts near Catania and flights are diverted",
        "2026-10-06T08:00:00Z",
      ),
    ];
    feeds["bbc-world"] = [
      world(
        "quake",
        "bbc-world",
        "Earthquake of magnitude 6.1 strikes Izmir coast, Turkey",
        "2026-10-10T09:00:00Z",
      ),
      world(
        "storm",
        "bbc-world",
        "Taiwan evacuates east coast as Typhoon Haikui hits",
        "2026-10-07T09:00:00Z",
      ),
      world(
        "etna",
        "bbc-world",
        "Etna eruption near Catania diverts flights, volcano alert raised",
        "2026-10-06T09:00:00Z",
      ),
    ];
    return feeds;
  }

  async function sunday(skip: string[]) {
    // World's stored `enabled` is false: a general topic is always on, so it must not matter.
    const base = resolveTopics(null, realPreferences());
    const topics = TopicsFile.parse({
      ...base,
      topics: base.topics.map((t) => (t.id === "world" ? { ...t, enabled: false } : t)),
    });
    await seed(repo.root, {
      "config/sources.json": registry(),
      "config/topics.json": serializeTopics(topics),
      "config/schedule.json": json({
        version: 1,
        hour: 7,
        cadence_days: 2,
        skip_topics: skip,
        weekly: { skip_topics: skip },
        general_scoped: true,
      }),
      "state/last-run.json": json({
        version: 1,
        regular: {
          at: "2026-10-09T05:13:00Z",
          outcome: "published",
          digest_id: "2026-10-09",
          items: 8,
        },
        last_fetch_at: "2026-10-09T05:13:00Z",
      }),
    });
    const run = makeWorld(repo.root, {
      now: SUN,
      feeds: sundayFeeds(),
      generalJudge: generalJev().judge,
    });
    await runStage(run, { force: true });
    return {
      regular: await readDigest(repo.root, "Digests/2026/10/2026-10-11.md"),
      weekly: await readDigest(repo.root, "Digests/2026/10/2026-10-11-weekly.md"),
    };
  }

  it("publishes a World section in both digests when World is not skipped", LONG, async () => {
    const { regular, weekly } = await sunday(GENERAL.filter((id) => id !== "world"));
    for (const digest of [regular, weekly]) {
      const section = digest.items.filter((item) => item.section === "world");
      expect(section.length, digest.id).toBeGreaterThanOrEqual(1);
      expect(section.length).toBeLessThanOrEqual(2);
      expect(section.every((item) => item.category === "world")).toBe(true);
      expect(digest.section_titles?.world).toBe("World");
      expect(digest.items.some((item) => item.section === "business")).toBe(false);
      expect(digest.items.some((item) => item.section === "top" && item.category === "world")).toBe(
        false,
      );
    }
  });

  it("publishes no general section when every general topic is skipped", LONG, async () => {
    const { regular, weekly } = await sunday(GENERAL);
    for (const digest of [regular, weekly]) {
      expect(digest.items.some((item) => GENERAL.includes(item.section))).toBe(false);
    }
  });
});
