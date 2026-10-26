import type { Item, SourceStatsFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import type { SourceFetcher } from "../src/fetch/types.js";
import type { HttpClient } from "../src/http.js";
import {
  answeredBefore,
  BACKFILL_DAYS,
  countSample,
  type FeedRead,
  mergeSampleCounts,
  PROBE_PER_SOURCE,
  pickSample,
  planReads,
  REFILL_DAYS,
  readFeeds,
  SAMPLE_PER_SOURCE,
} from "../src/run/scoreSample.js";
import { recordSourceStats, rollWindow } from "../src/state/sourceStats.js";
import { makeSource } from "./fetch-helpers.js";
import { makeEntry, makeItem, realPreferences } from "./score-factories.js";

const NOW = new Date("2026-10-12T05:00:00Z");
const TODAY = "2026-10-12";
const DAY = 86_400_000;

function stats(rows: Record<string, { judged: number; sampled_at?: string }>): SourceStatsFile {
  return {
    version: 1,
    sources: Object.fromEntries(
      Object.entries(rows).map(([id, row]) => [
        id,
        { fetched: 0, passed: 0, published: 0, window_start: "2026-10-01", ...row },
      ]),
    ),
  };
}

function items(sourceId: string, count: number, startDay = 1): Item[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({
      source_id: sourceId,
      url: `https://${sourceId}.example/post-${startDay + i}`,
      published_at: new Date(NOW.getTime() - (startDay + i) * DAY).toISOString(),
    }),
  );
}

describe("planReads", () => {
  it("reads a new source's feed BACKFILL_DAYS back, and again REFILL_DAYS back once a month", () => {
    const plan = planReads({
      sources: [
        makeSource({ id: "fresh" }),
        makeSource({ id: "read-lately" }),
        makeSource({ id: "read-long-ago" }),
        makeSource({ id: "scored" }),
      ],
      stats: stats({
        "read-lately": { judged: 2, sampled_at: "2026-10-01" },
        "read-long-ago": { judged: 2, sampled_at: "2026-09-01" },
        scored: { judged: 12 },
      }),
      today: TODAY,
      now: NOW,
    });
    const byId = new Map(plan.reads.map((read) => [read.source.id, read]));
    expect([...byId.keys()].sort()).toEqual(["fresh", "read-long-ago"]);
    expect(byId.get("fresh")?.reason).toBe("refill");
    expect(byId.get("fresh")?.from.getTime()).toBe(NOW.getTime() - BACKFILL_DAYS * DAY);
    expect(byId.get("read-long-ago")?.from.getTime()).toBe(NOW.getTime() - REFILL_DAYS * DAY);
  });

  it("checks a switched-off feed weekly, and a switched-off general feed with the general feeds", () => {
    const plan = planReads({
      sources: [
        makeSource({ id: "off", enabled: false }),
        makeSource({ id: "off-this-week", enabled: false }),
        makeSource({ id: "off-general", enabled: false, topic_ids: ["world"] }),
        makeSource({ id: "off-page", enabled: false, type: "firecrawl", feed_url: null }),
      ],
      stats: stats({ "off-this-week": { judged: 0, sampled_at: "2026-10-09" } }),
      today: TODAY,
      now: NOW,
    });
    expect(plan.reads.map((read) => [read.source.id, read.reason])).toEqual([["off", "probe"]]);
    expect(plan.probeGeneral.map((source) => source.id)).toEqual(["off-general"]);
  });

  it("does not refill a feed that is failing its own fetch", () => {
    const plan = planReads({
      sources: [makeSource({ id: "dead", failures: 3 }), makeSource({ id: "flaky", failures: 1 })],
      stats: stats({}),
      today: TODAY,
      now: NOW,
    });
    expect(plan.reads.map((read) => read.source.id)).toEqual(["flaky"]);
  });

  it("leaves general feeds, which are judged in full, and pages it cannot read itself", () => {
    const plan = planReads({
      sources: [
        makeSource({ id: "world-desk", topic_ids: ["world"] }),
        makeSource({ id: "page", type: "firecrawl", feed_url: null }),
        makeSource({ id: "hn", type: "hn" }),
      ],
      stats: stats({}),
      today: TODAY,
      now: NOW,
    });
    expect(plan.reads).toEqual([]);
    expect(plan.probeGeneral).toEqual([]);
  });

  it("serves the sources with the fewest judged items first, up to the read ceiling", () => {
    const plan = planReads({
      sources: [makeSource({ id: "c" }), makeSource({ id: "a" }), makeSource({ id: "b" })],
      stats: stats({ a: { judged: 6 }, b: { judged: 1 }, c: { judged: 3 } }),
      today: TODAY,
      now: NOW,
      readCeiling: 2,
    });
    expect(plan.reads.map((read) => read.source.id)).toEqual(["b", "c"]);
  });
});

describe("pickSample", () => {
  const refill = (id: string): FeedRead => ({
    source: makeSource({ id }),
    reason: "refill",
    from: new Date(NOW.getTime() - BACKFILL_DAYS * DAY),
  });

  it("gives a source its missing items: left-overs up to SAMPLE_PER_SOURCE, a feed read all it lacks", () => {
    const picked = pickSample({
      sources: [makeSource({ id: "leftover-only" }), makeSource({ id: "refilled" })],
      stats: stats({ "leftover-only": { judged: 2 }, refilled: { judged: 3 } }),
      leftovers: items("leftover-only", 9),
      reads: [refill("refilled")],
      read: new Map([["refilled", items("refilled", 12)]]),
      known: () => false,
    });
    const count = (id: string): number => picked.filter((item) => item.source_id === id).length;
    expect(count("leftover-only")).toBe(SAMPLE_PER_SOURCE);
    expect(count("refilled")).toBe(7);
  });

  it("never samples an item a judge answered, takes one copy of a post, and the newest first", () => {
    const posts = items("blog", 6);
    const picked = pickSample({
      sources: [makeSource({ id: "blog" })],
      stats: stats({ blog: { judged: 7 } }),
      leftovers: posts.slice(0, 2),
      reads: [refill("blog")],
      read: new Map([["blog", posts]]),
      known: (id) => id === posts[0]?.id,
    });
    expect(picked.map((item) => item.id)).toEqual([posts[1]?.id, posts[2]?.id, posts[3]?.id]);
  });

  it("checks a switched-off source with PROBE_PER_SOURCE items, and samples no other off source", () => {
    const picked = pickSample({
      sources: [
        makeSource({ id: "off", enabled: false }),
        makeSource({ id: "idle", enabled: false }),
      ],
      stats: stats({ off: { judged: 30 } }),
      leftovers: items("idle", 5),
      reads: [{ source: makeSource({ id: "off", enabled: false }), reason: "probe", from: NOW }],
      read: new Map([["off", items("off", 9)]]),
      known: () => false,
    });
    expect(picked.every((item) => item.source_id === "off")).toBe(true);
    expect(picked).toHaveLength(PROBE_PER_SOURCE);
  });

  it("leaves scored sources and general feeds alone", () => {
    const picked = pickSample({
      sources: [makeSource({ id: "scored" }), makeSource({ id: "desk", topic_ids: ["world"] })],
      stats: stats({ scored: { judged: 10 } }),
      leftovers: [...items("scored", 4), ...items("desk", 4)],
      reads: [],
      read: new Map(),
      known: () => false,
    });
    expect(picked).toEqual([]);
  });

  it("stops at the ceiling, serving the sources with the fewest judged items first", () => {
    const picked = pickSample({
      sources: [makeSource({ id: "near" }), makeSource({ id: "far" })],
      stats: stats({ near: { judged: 8 }, far: { judged: 0 } }),
      leftovers: [...items("near", 4), ...items("far", 4)],
      reads: [],
      read: new Map(),
      known: () => false,
      ceiling: 5,
    });
    expect(picked.filter((item) => item.source_id === "far")).toHaveLength(4);
    expect(picked.filter((item) => item.source_id === "near")).toHaveLength(1);
  });
});

describe("answeredBefore", () => {
  it("knows items in the judgment cache, under any model, and items seen in a pool", () => {
    const cached = makeItem();
    const known = answeredBefore(
      { version: 1, entries: { [`${cached.id}:h:m`]: makeEntry(cached, { model: "m" }) } },
      { version: 1, items: { "seen-id": "2026-09-01" } },
    );
    expect(known(cached.id)).toBe(true);
    expect(known("seen-id")).toBe(true);
    expect(known("new-id")).toBe(false);
  });
});

describe("countSample", () => {
  it("counts a sampled item as judged, sampled and asked; passed on its built-in categories", () => {
    const good = makeItem({ source_id: "blog" });
    const weak = makeItem({ source_id: "blog" });
    const hyped = makeItem({ source_id: "blog" });
    const counts = countSample({
      sample: {
        version: 1,
        items: [good, weak, hyped],
        reads: ["blog", "quiet"],
        feed_posts: { blog: 3, quiet: 0 },
        general_reads: {},
      },
      judged: {
        version: 1,
        entries: [
          makeEntry(good, { category: "design_engineering_craft", p: 0.95, depth: 0.9 }),
          makeEntry(weak, { category: "none", p: 0.9 }),
          makeEntry(hyped, {
            category: "design_engineering_craft",
            p: 0.95,
            depth: 0.9,
            hype: 0.6,
          }),
        ],
        unjudged: [],
      },
      preferences: realPreferences(),
    });
    expect(counts.blog).toMatchObject({
      judged: 3,
      sampled: 3,
      asked: 3,
      flagged: 1,
      read_feed: true,
    });
    // The hyped craft item still clears the bar (its discount leaves it at 0.42); "none" does not.
    expect(counts.blog?.passed).toBe(2);
    // A read that found nothing still moves the source's sampled_at.
    expect(counts.quiet).toMatchObject({ judged: 0, read_feed: true });
  });

  it("counts nothing, reads included, when the sample was not judged", () => {
    const counts = countSample({
      sample: {
        version: 1,
        items: [makeItem({ source_id: "blog" })],
        reads: ["blog"],
        feed_posts: {},
        general_reads: {},
      },
      judged: null,
      preferences: realPreferences(),
    });
    expect(counts).toEqual({});
  });

  it("leaves a read undone when the judge answered none of its items (an outage)", () => {
    const item = makeItem({ source_id: "blog" });
    const counts = countSample({
      sample: {
        version: 1,
        items: [item],
        reads: ["blog", "empty"],
        feed_posts: { blog: 6, empty: 0 },
        general_reads: {},
      },
      judged: { version: 1, entries: [], unjudged: [item.id] },
      preferences: realPreferences(),
    });
    // The blog is read again next run; the feed that gave nothing has nothing to wait for.
    expect(counts.blog).toBeUndefined();
    expect(counts.empty).toMatchObject({ read_feed: true, feed_posts: 0 });
  });

  it("counts a general feed's check as done once tried, even when the sample was not judged", () => {
    const sample = {
      version: 1 as const,
      items: [],
      reads: [],
      feed_posts: {},
      general_reads: { tried: 5, empty: 0 },
    };
    for (const judged of [{ version: 1 as const, entries: [], unjudged: [] }, null]) {
      const counts = countSample({ sample, judged, preferences: realPreferences() });
      expect(counts.tried).toMatchObject({ read_feed: true });
      expect(counts.empty).toMatchObject({ read_feed: true });
    }
  });

  it("leaves a read undone while the judge left one of its items unanswered", () => {
    const answered = makeItem({ source_id: "blog" });
    const lost = makeItem({ source_id: "blog" });
    const counts = countSample({
      sample: {
        version: 1,
        items: [answered, lost],
        reads: ["blog"],
        feed_posts: { blog: 8 },
        general_reads: {},
      },
      judged: { version: 1, entries: [makeEntry(answered)], unjudged: [lost.id] },
      preferences: realPreferences(),
    });
    // The answered item counts; the read waits, so the lost one is offered on the next run.
    expect(counts.blog).toMatchObject({ judged: 1, sampled: 1 });
    expect(counts.blog?.read_feed).toBeUndefined();
    expect(counts.blog?.feed_posts).toBeUndefined();
  });

  it("adds to a pass's counters without touching what was fetched or published", () => {
    const merged = mergeSampleCounts(
      { blog: { fetched: 9, judged: 2, passed: 1, asked: 2, flagged: 0 } },
      {
        blog: {
          fetched: 0,
          judged: 3,
          passed: 2,
          asked: 3,
          flagged: 1,
          sampled: 3,
          read_feed: true,
        },
      },
    );
    expect(merged.blog).toEqual({
      fetched: 9,
      judged: 5,
      passed: 3,
      asked: 5,
      flagged: 1,
      sampled: 3,
      read_feed: true,
    });
  });
});

describe("readFeeds", () => {
  it("reads each feed from its own start, and reports a failure without throwing", async () => {
    const windows: Array<[string, string]> = [];
    const fetchRss: SourceFetcher = async (source, window) => {
      windows.push([source.id, window.from.toISOString()]);
      if (source.id === "broken") throw new Error("HTTP 500\n  at somewhere");
      return items(source.id, 2);
    };
    const from = new Date(NOW.getTime() - 5 * DAY);
    const { items: got, results } = await readFeeds(
      [
        { source: makeSource({ id: "fine" }), reason: "refill", from },
        { source: makeSource({ id: "broken" }), reason: "probe", from },
      ],
      { http: {} as HttpClient, now: NOW, fetchers: { rss: fetchRss } },
    );
    expect(got.get("fine")).toHaveLength(2);
    expect(windows).toContainEqual(["fine", from.toISOString()]);
    expect(results.find((r) => r.source_id === "broken")).toMatchObject({
      ok: false,
      error: "HTTP 500 at somewhere",
    });
    expect(results.find((r) => r.source_id === "fine")).toMatchObject({ ok: true, count: 2 });
  });
});

describe("recordSourceStats with a sample", () => {
  it("adds sampled items, and moves sampled_at to the day the source's feed was read", () => {
    let file = recordSourceStats(
      { version: 1, sources: {} },
      {
        blog: {
          fetched: 0,
          judged: 4,
          passed: 2,
          asked: 4,
          flagged: 0,
          sampled: 4,
          read_feed: true,
        },
      },
      [],
      "2026-10-07",
    );
    file = recordSourceStats(
      file,
      { blog: { fetched: 6, judged: 1, passed: 1, asked: 1, flagged: 0 } },
      ["blog"],
      "2026-10-09",
    );
    expect(file.sources.blog).toEqual({
      fetched: 6,
      judged: 5,
      passed: 3,
      published: 1,
      asked: 5,
      flagged: 0,
      sampled: 4,
      sampled_at: "2026-10-07",
      window_start: "2026-10-07",
    });
  });

  it("keeps the feed's post count from its last refill, and replaces it on the next", () => {
    let file = recordSourceStats(
      { version: 1, sources: {} },
      { blog: { fetched: 0, judged: 3, passed: 1, sampled: 3, read_feed: true, feed_posts: 3 } },
      [],
      "2026-10-07",
    );
    file = recordSourceStats(
      file,
      { blog: { fetched: 2, judged: 0, passed: 0 } },
      [],
      "2026-10-09",
    );
    expect(file.sources.blog?.feed_posts).toBe(3);
    file = recordSourceStats(
      file,
      { blog: { fetched: 0, judged: 1, passed: 0, sampled: 1, read_feed: true, feed_posts: 12 } },
      [],
      "2026-11-09",
    );
    expect(file.sources.blog).toMatchObject({ feed_posts: 12, sampled_at: "2026-11-09" });
  });

  it("halves sampled with the rest when the window restarts, and keeps sampled_at", () => {
    const rolled = rollWindow(
      {
        fetched: 10,
        judged: 9,
        passed: 4,
        published: 1,
        sampled: 7,
        sampled_at: "2026-09-02",
        window_start: "2026-09-01",
      },
      "2026-10-05",
    );
    expect(rolled).toMatchObject({ judged: 4, sampled: 3, sampled_at: "2026-09-02" });
    expect(rolled.window_start).toBe("2026-10-05");
  });
});
