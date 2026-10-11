import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GENERAL_TOPICS,
  generalTopics,
  homeSection,
  type Item,
  isBuiltinCategory,
  SourceStat,
  type Topic,
} from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GENERAL_QUESTIONS_HASH,
  GeneralJudge,
  type GeneralRequest,
} from "../src/judge/generalJudge.js";
import {
  applyCeiling,
  buildGeneralPool,
  countGeneral,
  fitPasses,
  GENERAL_JUDGE_CEILING,
  type GeneralJudgedFile,
  GeneralPoolFile,
  mergeGeneralCounts,
  outletOf,
} from "../src/run/generalNews.js";
import { judgeGeneral } from "../src/run/judgeGeneral.js";
import { countSources } from "../src/run/sourceCounts.js";
import { urlKey } from "../src/sources/import.js";
import { loadSourcesRaw } from "../src/sources/registry.js";
import {
  API_SEED,
  APP_TOPIC_SOURCES,
  GENERAL_TOPIC_SOURCES,
  SEEDED_HOSTS,
} from "../src/sources/seed.js";
import { recordSourceStats, rollWindow } from "../src/state/sourceStats.js";
import { makeSource } from "./fetch-helpers.js";
import { bareDeps, WED } from "./orchestrator-fixtures.js";
import { makeItem, REPO_ROOT } from "./score-factories.js";
import { NO_WAIT } from "./write-fakes.js";

void SEEDED_HOSTS;

// --- the seed ------------------------------------------------------------------------------------

describe("the general news sources", () => {
  const general = GENERAL_TOPIC_SOURCES.filter((s) => s.enabled);
  const tech = GENERAL_TOPIC_SOURCES.filter((s) => !s.enabled);

  it("gives every general topic at least five enabled rss feeds, tagged with the topic alone", () => {
    for (const { id } of GENERAL_TOPICS) {
      const feeds = general.filter((s) => s.topic_ids?.[0] === id);
      // A general episode ranks a story by how many outlets carried it (D69).
      expect(feeds.length, id).toBeGreaterThanOrEqual(5);
      for (const feed of feeds) {
        expect(feed).toMatchObject({
          type: "rss",
          tier: "daily",
          high_signal: false,
          enabled: true,
          origin: "seed",
        });
        expect(feed.topic_ids).toEqual([id]);
        // Every story is judged, so no per-source pool cap sits in the way.
        expect(feed.options.pool_cap).toBeUndefined();
        expect(feed.feed_url).toMatch(/^https:\/\//);
      }
    }
    expect(general).toHaveLength(30);
  });

  it("files the four technology feeds under the built-in topic of the Tech section, switched off", () => {
    expect(tech).toHaveLength(4);
    for (const feed of tech) {
      const [topic] = feed.topic_ids ?? [];
      expect(feed.topic_ids).toHaveLength(1);
      expect(topic !== undefined && isBuiltinCategory(topic)).toBe(true);
      expect(homeSection(topic as never)).toBe("tech");
      expect(feed.category_hint).toBe(topic);
      expect(feed.enabled).toBe(false);
    }
  });

  it("has unique ids and unique addresses beside every other seeded source", () => {
    const all = [...API_SEED, ...APP_TOPIC_SOURCES, ...GENERAL_TOPIC_SOURCES];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(new Set(all.map((s) => urlKey(s.url))).size).toBe(all.length);
    const mine = GENERAL_TOPIC_SOURCES.map((s) => s.feed_url);
    expect(new Set(mine).size).toBe(mine.length);
    // The same outlet under several topics reads as one outlet.
    expect(outletOf(makeSource({ id: "a", url: "https://www.npr.org/sections/world/" }))).toBe(
      "npr.org",
    );
    expect(GENERAL_TOPIC_SOURCES.filter((s) => outletOf(s) === "npr.org").length).toBe(6);
  });

  it("is in config/sources.json exactly as the seed writes it", async () => {
    const file = await loadSourcesRaw(REPO_ROOT);
    for (const draft of GENERAL_TOPIC_SOURCES) {
      expect(
        file.sources.find((s) => s.id === draft.id),
        draft.id,
      ).toEqual({
        ...draft,
        failures: 0,
      });
    }
  });
});

// --- grouping the stories ------------------------------------------------------------------------

function feedItem(sourceId: string, slug: string, title: string, over: Partial<Item> = {}): Item {
  return makeItem({
    url: `https://${sourceId}.example/${slug}`,
    title,
    source_id: sourceId,
    published_at: "2026-10-06T08:00:00Z",
    snippet: `${title} in detail.`,
    topic_ids: ["world"],
    ...over,
  });
}

const SOURCES = new Map(
  [
    makeSource({
      id: "npr-world",
      url: "https://www.npr.org/sections/world/",
      topic_ids: ["world"],
    }),
    makeSource({
      id: "npr-business",
      url: "https://www.npr.org/sections/business/",
      topic_ids: ["business"],
    }),
    makeSource({ id: "bbc-world", url: "https://www.bbc.com/news/world", topic_ids: ["world"] }),
    makeSource({ id: "abc-world", url: "https://abcnews.com/International", topic_ids: ["world"] }),
  ].map((s) => [s.id, s]),
);
const QUAKE = "Magnitude 6.1 earthquake strikes Izmir coast in Turkey";

describe("buildGeneralPool", () => {
  const active = new Set(["world", "business"]);

  it("counts a story once per outlet: two desks of one outlet are not coverage", () => {
    const url = "https://npr.example/shared";
    const pool = buildGeneralPool({
      items: [
        feedItem("npr-world", "x", QUAKE, { url, canonical_url: url }),
        feedItem("npr-business", "x", QUAKE, {
          url,
          canonical_url: url,
          topic_ids: ["business"],
        }),
      ],
      sources: SOURCES,
      activeTopicIds: active,
    });
    expect(pool.items).toHaveLength(1);
    expect(pool.items[0]?.signals.coverage).toBeUndefined();
    expect(pool.items[0]?.topic_ids).toEqual(["business", "world"]);
    expect(pool.carriers[pool.items[0]?.id ?? ""]).toEqual(["npr-business", "npr-world"]);
    expect(pool.report).toMatchObject({ fetched: 2, same_url: 1, stories: 1 });
  });

  it("clusters the same story at other outlets, keeps every carrier and records the coverage", () => {
    const pool = buildGeneralPool({
      items: [
        feedItem("npr-world", "quake", QUAKE),
        feedItem("bbc-world", "quake", "Earthquake of magnitude 6.1 strikes Izmir coast, Turkey"),
        feedItem("abc-world", "quake", "Turkey earthquake: magnitude 6.1 strikes Izmir coast"),
        feedItem("abc-world", "volcano", "Volcano in Iceland erupts near Reykjanes town"),
      ],
      sources: SOURCES,
      activeTopicIds: active,
    });
    expect(pool.items).toHaveLength(2);
    const quake = pool.items.find((i) => /arthquake/.test(i.title));
    expect(quake?.signals.coverage).toBe(3);
    expect([...(pool.carriers[quake?.id ?? ""] ?? [])].sort()).toEqual([
      "abc-world",
      "bbc-world",
      "npr-world",
    ]);
    const volcano = pool.items.find((i) => /Volcano/.test(i.title));
    expect(volcano?.signals.coverage).toBeUndefined();
    expect(pool.report.story_clustered).toBe(2);
    expect(GeneralPoolFile.safeParse(pool).success).toBe(true);
  });

  it("drops a story whose topics are all switched off and trims the others", () => {
    const pool = buildGeneralPool({
      items: [
        feedItem("npr-world", "a", "Leaders reach climate summit deal in Geneva"),
        feedItem("npr-business", "b", "Central bank holds interest rates steady", {
          topic_ids: ["business", "sports"],
        }),
      ],
      sources: SOURCES,
      activeTopicIds: new Set(["business"]),
    });
    expect(pool.items.map((i) => i.title)).toEqual(["Central bank holds interest rates steady"]);
    expect(pool.items[0]?.topic_ids).toEqual(["business"]);
  });
});

describe("applyCeiling", () => {
  const items = Array.from({ length: 10 }, (_, n) =>
    feedItem("npr-world", `s${n}`, `Story number ${n}`, {
      published_at: `2026-10-06T0${n}:00:00Z`,
      signals: n === 0 ? { coverage: 3 } : {},
    }),
  );

  it("is 600 and keeps every story under it", () => {
    expect(GENERAL_JUDGE_CEILING).toBe(600);
    expect(applyCeiling(items, 600)).toEqual({ kept: items, over: 0 });
  });

  it("keeps the most carried, then the newest, when over", () => {
    const { kept, over } = applyCeiling(items, 3);
    expect(over).toBe(7);
    expect(kept.map((i) => i.title)).toEqual([
      "Story number 0",
      "Story number 9",
      "Story number 8",
    ]);
  });

  it("puts a story only a weekly check carried behind every other, however widely carried (D70)", () => {
    const checkedOnly = (item: { title: string }) => item.title === "Story number 0";
    const { kept } = applyCeiling(items, 3, checkedOnly);
    expect(kept.map((i) => i.title)).toEqual([
      "Story number 9",
      "Story number 8",
      "Story number 7",
    ]);
  });
});

// --- counters ------------------------------------------------------------------------------------

describe("countGeneral", () => {
  const world = generalTopics().find((t) => t.id === "world") as Topic;
  const quake = feedItem("npr-world", "quake", QUAKE, { signals: { coverage: 2 } });
  const dull = feedItem("npr-world", "dull", "Mayor opens a library", {});
  const pool: GeneralPoolFile = {
    version: 1,
    items: [quake, dull],
    carriers: { [quake.id]: ["npr-world", "bbc-world"], [dull.id]: ["npr-world"] },
    report: { fetched: 3, same_url: 0, story_clustered: 1, stories: 2 },
  };
  const judged: GeneralJudgedFile = {
    version: 1,
    judge: { model: "jev-test", questions_hash: GENERAL_QUESTIONS_HASH },
    entries: [
      { item_id: quake.id, flags: { hype: 0.1, sponsored: 0 }, fits: { world: 1 }, hashes: {} },
      { item_id: dull.id, flags: { hype: 0.8, sponsored: 0 }, fits: { world: 0.25 }, hashes: {} },
    ],
    unjudged: [],
    counts: { pool: 2, over_ceiling: 0, reused: 0, requests: 2, judged: 2, unjudged: 0 },
  };

  it("credits every carrier with judged, asked, flagged, passed and covered", () => {
    const counts = countGeneral({ pool, judged, topics: [world] });
    expect(counts["npr-world"]).toEqual({
      fetched: 0,
      judged: 2,
      passed: 1,
      asked: 2,
      flagged: 1,
      covered: 1,
    });
    expect(counts["bbc-world"]).toEqual({
      fetched: 0,
      judged: 1,
      passed: 1,
      asked: 1,
      flagged: 0,
      covered: 1,
    });
  });

  it("holds a fit to the bar every topic is held to: weight times fit^1.5 against 0.4", () => {
    expect(fitPasses({ weight: 1 }, 0.55)).toBe(true);
    expect(fitPasses({ weight: 1 }, 0.5)).toBe(false);
    expect(fitPasses({ weight: 0.6 }, 0.75)).toBe(false);
  });

  it("does not count a story the judge left out, and adds to a source's briefing counts", () => {
    const counts = countGeneral({ pool, judged: { ...judged, entries: [] }, topics: [world] });
    expect(counts).toEqual({});
    const merged = mergeGeneralCounts(
      countSources({
        fetchedBySource: { "npr-world": 4, "blog-a": 2 },
        poolSourceIds: new Map(),
        judgedIds: [],
        asked: new Map(),
        passedIds: new Set(),
      }),
      countGeneral({ pool, judged, topics: [world] }),
    );
    expect(merged["npr-world"]).toMatchObject({ fetched: 4, judged: 2, covered: 1 });
    expect(merged["blog-a"]).not.toHaveProperty("covered");
  });
});

describe("source stats for a general feed", () => {
  it("accumulates covered beside the other counters, leaves published at 0, and halves it", () => {
    const counts = {
      "npr-world": { fetched: 5, judged: 4, passed: 3, asked: 4, flagged: 1, covered: 2 },
    };
    let stats = recordSourceStats({ version: 1, sources: {} }, counts, [], "2026-10-07");
    stats = recordSourceStats(stats, counts, [], "2026-10-09");
    expect(stats.sources["npr-world"]).toMatchObject({
      fetched: 10,
      judged: 8,
      passed: 6,
      asked: 8,
      flagged: 2,
      covered: 4,
      published: 0,
    });
    expect(SourceStat.safeParse(stats.sources["npr-world"]).success).toBe(true);
    expect(rollWindow(stats.sources["npr-world"] as never, "2026-11-20").covered).toBe(2);
    // A source with no general stories never gets the field.
    const plain = recordSourceStats(
      stats,
      { blog: { fetched: 1, judged: 1, passed: 0 } },
      [],
      "2026-10-09",
    );
    expect(plain.sources.blog).not.toHaveProperty("covered");
  });
});

// --- the judge -----------------------------------------------------------------------------------

describe("GeneralJudge", () => {
  const world = generalTopics().find((t) => t.id === "world") as Topic;
  const science = generalTopics().find((t) => t.id === "science") as Topic;

  function fakeClient(level: number, noul = 0.9) {
    const asked: string[][] = [];
    return {
      asked,
      client: {
        async systemOne(request: { questions: Record<string, unknown> }) {
          const keys = Object.keys(request.questions);
          asked.push(keys);
          return {
            model: "jev-test",
            answers: Object.fromEntries(
              keys.map((key) => [
                key,
                key === "hype" || key === "sponsored"
                  ? { type: "noul", noul: key === "hype" ? noul : 0 }
                  : { type: "score", score: level },
              ]),
            ),
          };
        },
      },
    };
  }

  it("asks the topic's fit question and the two trust flags, never the category questions", async () => {
    const jev = fakeClient(4);
    const judge = new GeneralJudge({ client: jev.client, now: () => WED, retry: NO_WAIT });
    const item = feedItem("npr-world", "q", QUAKE, { topic_ids: ["world", "science"] });
    const answers = await judge.judge([{ item, topics: [world, science] }]);
    expect(jev.asked).toEqual([["hype", "sponsored", "fit_0", "fit_1"]]);
    expect(answers).toHaveLength(1);
    expect(answers[0]?.flags).toEqual({ hype: 0.9, sponsored: 0 });
    expect(answers[0]?.fits.map((f) => [f.topic_id, f.fit])).toEqual([
      ["world", 1],
      ["science", 1],
    ]);
    expect(judge.usage.requests).toBe(1);
  });

  it("builds the fit question from the topic's name and description", async () => {
    const seen: string[] = [];
    const judge = new GeneralJudge({
      client: {
        async systemOne(request) {
          seen.push(JSON.stringify(request.questions));
          return { answers: {} };
        },
      },
      now: () => WED,
      retry: NO_WAIT,
    });
    await judge.judge([{ item: feedItem("npr-world", "q", QUAKE), topics: [world] }]);
    expect(seen[0]).toContain(world.description);
    expect(seen[0]).toContain(world.name);
  });

  it("leaves a story out, and reports it, when Jev fails", async () => {
    const failures: string[] = [];
    const judge = new GeneralJudge({
      client: {
        async systemOne() {
          throw new Error("HTTP 400 nope");
        },
      },
      retry: NO_WAIT,
      onFailure: (f) => failures.push(f.itemId),
    });
    const item = feedItem("npr-world", "q", QUAKE);
    expect(await judge.judge([{ item, topics: [world] }])).toEqual([]);
    expect(failures).toEqual([item.id]);
  });
});

// --- the judge step ------------------------------------------------------------------------------

describe("judgeGeneral", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dispatch-general-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const pass = {
    id: "2026-10-07",
    kind: "regular" as const,
    window: { from: "2026-10-05T05:13:00.000Z", to: "2026-10-07T05:13:00.000Z" },
  };

  async function writePool(items: Item[]): Promise<void> {
    const { writeJson } = await import("../src/curate/output.js");
    await writeJson(join(dir, ".cache", "run", pass.id, "general.json"), {
      version: 1,
      items,
      carriers: Object.fromEntries(items.map((i) => [i.id, [i.source_id]])),
      report: { fetched: items.length, same_url: 0, story_clustered: 0, stories: items.length },
    });
  }

  function runtimeWith(judge: GeneralJudge | null) {
    return { generalJudge: judge } as never;
  }

  function countingJudge() {
    const calls: GeneralRequest[][] = [];
    const judge = new GeneralJudge({
      client: {
        async systemOne(request) {
          const keys = Object.keys(request.questions);
          return {
            answers: Object.fromEntries(
              keys.map((k) =>
                k === "hype" || k === "sponsored"
                  ? [k, { type: "noul", noul: 0 }]
                  : [k, { type: "score", score: 3 }],
              ),
            ),
          };
        },
      },
      now: () => WED,
      retry: NO_WAIT,
    });
    const original = judge.judge.bind(judge);
    judge.judge = async (requests) => {
      calls.push([...requests]);
      return original(requests);
    };
    return { judge, calls };
  }

  it("judges every story, over several topics, not a sample", async () => {
    const items = Array.from({ length: 25 }, (_, n) =>
      feedItem("npr-world", `s${n}`, `Distinct headline ${n} alpha${n}`),
    );
    await writePool(items);
    const { judge, calls } = countingJudge();
    const report = await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(judge), null);
    expect(report).toMatchObject({ general_pool: 25, general_judged: 25, general_requests: 25 });
    expect(calls[0]).toHaveLength(25);
    const written = JSON.parse(
      await readFile(join(dir, ".cache", "run", pass.id, "general-judged.json"), "utf8"),
    ) as GeneralJudgedFile;
    expect(written.entries).toHaveLength(25);
    expect(written.judge.questions_hash).toBe(GENERAL_QUESTIONS_HASH);
  });

  it("skips a topic that is switched off and asks nothing for a story with no topic left", async () => {
    await writePool([feedItem("npr-world", "a", "Some world story today")]);
    const { judge, calls } = countingJudge();
    const topics = {
      version: 1 as const,
      sections: [],
      topics: generalTopics().map((t) => ({ ...t, enabled: false })),
    };
    const report = await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(judge), topics);
    expect(report).toMatchObject({ general_judged: 0, general_requests: 0 });
    expect(calls).toHaveLength(0);
  });

  it("stops at the safety ceiling, logs it, and leaves the least carried waiting", async () => {
    const over = GENERAL_JUDGE_CEILING + 5;
    const items = Array.from({ length: over }, (_, n) =>
      feedItem("npr-world", `s${n}`, `Headline ${n} word${n}`, {
        published_at: new Date(Date.UTC(2026, 9, 6, 0, 0) + n * 60_000).toISOString(),
      }),
    );
    await writePool(items);
    const deps = bareDeps(dir, WED);
    const warnings: string[] = [];
    deps.log.warn = (message: string) => {
      warnings.push(message);
    };
    const { judge, calls } = countingJudge();
    const report = await judgeGeneral(deps, pass, runtimeWith(judge), null);
    expect(report).toMatchObject({
      general_judged: GENERAL_JUDGE_CEILING,
      general_over_ceiling: 5,
    });
    expect(calls[0]).toHaveLength(GENERAL_JUDGE_CEILING);
    expect(warnings.some((m) => /safety ceiling/.test(m))).toBe(true);
    // The five oldest are the ones that wait.
    const asked = new Set((calls[0] ?? []).map((r) => r.item.id));
    expect(items.slice(0, 5).some((i) => asked.has(i.id))).toBe(false);
  });

  it("does not ask again what an earlier attempt of the pass already answered", async () => {
    await writePool([
      feedItem("npr-world", "a", "First world story today"),
      feedItem("npr-world", "b", "Second world story today"),
    ]);
    const first = countingJudge();
    await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(first.judge), null);
    const second = countingJudge();
    const report = await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(second.judge), null);
    expect(report).toMatchObject({ general_reused: 2, general_requests: 0, general_judged: 2 });
    expect(second.calls).toHaveLength(0);
  });

  it("is skipped, with a warning and no file, when there is no Jev client", async () => {
    await writePool([feedItem("npr-world", "a", "First world story today")]);
    const report = await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(null), null);
    expect(report).toEqual({ general_pool: 1, general_judged: 0, general_skipped: 1 });
    await expect(
      readFile(join(dir, ".cache", "run", pass.id, "general-judged.json")),
    ).rejects.toThrow();
  });

  it("does nothing for a pass that read no general feed", async () => {
    const { judge } = countingJudge();
    expect(await judgeGeneral(bareDeps(dir, WED), pass, runtimeWith(judge), null)).toBeNull();
  });
});
