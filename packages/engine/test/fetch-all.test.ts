import type { Item, Source } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_TYPE_LIMITS, fetchAll, selectSources } from "../src/fetch/fetchAll.js";
import { FETCHERS } from "../src/fetch/fetchers.js";
import { EMPTY_FIRECRAWL_STATE, FirecrawlGuard } from "../src/fetch/firecrawlBudget.js";
import { createLimiter } from "../src/fetch/limiter.js";
import { type SourceFetcher, SourceSkipped } from "../src/fetch/types.js";
import { fakeFetch, fixture, makeDeps, makeItem, makeSource, WIDE } from "./fetch-helpers.js";

const deps = makeDeps(fakeFetch({}));
const itemFor = (source: Source): Item =>
  makeItem({
    url: `https://example.com/${source.id}`,
    title: `From ${source.id}`,
    source_id: source.id,
  });
const okFetcher: SourceFetcher = async (source) => [itemFor(source)];

describe("selectSources", () => {
  const sources = [
    makeSource({ id: "daily-a" }),
    makeSource({ id: "weekly-a", tier: "weekly" }),
    makeSource({ id: "off", enabled: false }),
  ];

  it("runs daily sources only in regular mode and everything enabled in weekly mode", () => {
    expect(selectSources(sources, "regular").map((s) => s.id)).toEqual(["daily-a"]);
    expect(selectSources(sources, "weekly").map((s) => s.id)).toEqual(["daily-a", "weekly-a"]);
  });

  it("never selects disabled sources and can restrict to ids", () => {
    expect(selectSources(sources, "weekly", ["off", "weekly-a"]).map((s) => s.id)).toEqual([
      "weekly-a",
    ]);
  });
});

describe("fetchAll", () => {
  it("returns items and one result per source, in source order", async () => {
    const sources = ["a", "b", "c"].map((id) => makeSource({ id }));
    const { items, results } = await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      fetchers: { rss: okFetcher },
    });
    expect(items.map((i) => i.source_id)).toEqual(["a", "b", "c"]);
    expect(results.map((r) => [r.source_id, r.ok, r.count])).toEqual([
      ["a", true, 1],
      ["b", true, 1],
      ["c", true, 1],
    ]);
    expect(results.every((r) => typeof r.ms === "number" && r.ms >= 0)).toBe(true);
  });

  it("never throws for one failing source and records its error", async () => {
    const sources = ["good", "bad", "also-good"].map((id) => makeSource({ id }));
    const fetcher: SourceFetcher = async (source) => {
      if (source.id === "bad") throw new Error("HTTP 500\nwith a newline");
      return [itemFor(source)];
    };
    const { items, results } = await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      fetchers: { rss: fetcher },
    });
    expect(items).toHaveLength(2);
    expect(results[1]).toMatchObject({
      source_id: "bad",
      ok: false,
      count: 0,
      error: "HTTP 500 with a newline",
    });
  });

  it("times a source out without waiting for a fetcher that ignores its signal", async () => {
    const sources = [makeSource({ id: "hang" }), makeSource({ id: "fine" })];
    const fetcher: SourceFetcher = (source) =>
      source.id === "hang" ? new Promise<Item[]>(() => {}) : Promise.resolve([itemFor(source)]);
    const { items, results } = await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      timeoutMs: 40,
      fetchers: { rss: fetcher },
    });
    expect(results[0]).toMatchObject({ source_id: "hang", ok: false });
    expect(results[0]?.error).toMatch(/timed out after 40 ms/);
    expect(items).toHaveLength(1);
  });

  it("gives each fetcher a signal that aborts at the deadline", async () => {
    let aborted = false;
    const fetcher: SourceFetcher = (_source, _window, sourceDeps) =>
      new Promise<Item[]>((_resolve, reject) => {
        sourceDeps.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    await fetchAll([makeSource({ id: "slow" })], WIDE, deps, {
      mode: "regular",
      timeoutMs: 30,
      fetchers: { rss: fetcher },
    });
    expect(aborted).toBe(true);
  });

  it("runs at most six sources at once by default", async () => {
    let active = 0;
    let peak = 0;
    const fetcher: SourceFetcher = async (source) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return [itemFor(source)];
    };
    const sources = Array.from({ length: 20 }, (_, i) => makeSource({ id: `s${i}` }));
    const { results } = await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      fetchers: { rss: fetcher },
    });
    expect(results).toHaveLength(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("applies per-type concurrency, so a rate-limited service never runs wide", async () => {
    let active = 0;
    let peak = 0;
    const slow: SourceFetcher = async (source) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return [itemFor(source)];
    };
    const sources = Array.from({ length: 8 }, (_, i) =>
      makeSource({ id: `f${i}`, type: "firecrawl", feed_url: null }),
    );
    await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      fetchers: { firecrawl: slow },
      typeLimits: { firecrawl: { concurrency: 2 } },
    });
    expect(peak).toBe(2);
  });

  // YouTube answered every channel feed with HTTP 404 to GitHub's runners from about 2026-10-14
  // while serving it to other hosts: four channels and a channel filed as RSS went silent.
  it("reads a feed YouTube refused through Firecrawl, within the run's budget, and only YouTube's", async () => {
    const feed = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    const sources = [
      makeSource({
        id: "fireship",
        type: "youtube",
        feed_url: null,
        options: { channel_id: "UCa" },
      }),
      makeSource({ id: "friday-checkout", feed_url: feed("UCb") }),
      makeSource({ id: "blog", feed_url: "https://example.com/feed.xml" }),
    ];
    const relayed: string[] = [];
    let firecrawl = 200;
    const fake = fakeFetch({
      "https://www.youtube.com/feeds/": { status: 404 },
      "https://api.firecrawl.dev/v2/scrape": (_url, init) => {
        relayed.push((JSON.parse(String(init?.body)) as { url: string }).url);
        const data = { rawHtml: fixture("fetch-youtube.xml"), metadata: { statusCode: 200 } };
        return new Response(JSON.stringify({ success: true, data }), {
          status: firecrawl,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const run = (guard: FirecrawlGuard) =>
      fetchAll(sources, WIDE, makeDeps(fake, { firecrawl: { apiKey: "key", guard } }), {
        mode: "regular",
        sleep: async () => {},
      });
    // A budget of one: the first refused feed is relayed, the second keeps its refusal.
    const once = new FirecrawlGuard(EMPTY_FIRECRAWL_STATE, { ceiling: 1, listing: 0 });
    const { results } = await run(once);
    expect(results.map((r) => [r.source_id, r.ok])).toEqual([
      ["fireship", true],
      ["friday-checkout", false],
      ["blog", false],
    ]);
    expect(results[0]).toMatchObject({ via: "firecrawl" });
    expect(results[0]?.count).toBeGreaterThan(0);
    expect(results[1]?.error).toBe("HTTP 404; through Firecrawl: Firecrawl budget spent");
    expect(relayed).toEqual([feed("UCa")]);
    expect(once.snapshot.scrape).toBe(1);
    // The weekly pass reads the same feeds: the relayed one comes from the run's cache, free.
    const weekly = await run(once);
    expect(weekly.results[0]).toMatchObject({ ok: true, via: "firecrawl" });
    expect(relayed).toHaveLength(1);
    // Each rate-limited relay counts toward the run's stop and says why it failed.
    firecrawl = 429;
    const limited = new FirecrawlGuard();
    const again = await run(limited);
    expect(again.results[0]?.error).toMatch(/^HTTP 404; through Firecrawl: HTTP 429/);
    expect(limited.snapshot.rate_limited).toBe(2);
    expect(relayed).toHaveLength(3);
  });

  it("reports a skipped source as ok with a note, not as a failure", async () => {
    const fetcher: SourceFetcher = async () => {
      throw new SourceSkipped("FIRECRAWL_API_KEY is not set");
    };
    const { results } = await fetchAll(
      [makeSource({ id: "scrape", type: "firecrawl", feed_url: null })],
      WIDE,
      deps,
      {
        mode: "regular",
        fetchers: { firecrawl: fetcher },
      },
    );
    expect(results[0]).toMatchObject({ ok: true, count: 0, note: "FIRECRAWL_API_KEY is not set" });
    expect(results[0]).not.toHaveProperty("error");
  });

  it("honors tier and the enabled flag", async () => {
    const sources = [
      makeSource({ id: "d" }),
      makeSource({ id: "w", tier: "weekly" }),
      makeSource({ id: "x", enabled: false }),
    ];
    const regular = await fetchAll(sources, WIDE, deps, {
      mode: "regular",
      fetchers: { rss: okFetcher },
    });
    expect(regular.results.map((r) => r.source_id)).toEqual(["d"]);
    const weekly = await fetchAll(sources, WIDE, deps, {
      mode: "weekly",
      fetchers: { rss: okFetcher },
    });
    expect(weekly.results.map((r) => r.source_id)).toEqual(["d", "w"]);
  });

  it("passes the window and clock to fetchers", async () => {
    let seen: Date | undefined;
    const fetcher: SourceFetcher = async (_source, window) => {
      seen = window.from;
      return [];
    };
    await fetchAll([makeSource({ id: "a" })], WIDE, deps, {
      mode: "regular",
      fetchers: { rss: fetcher },
    });
    expect(seen).toEqual(WIDE.from);
  });

  it("has a fetcher for every source type and sane defaults for services", () => {
    expect(Object.keys(FETCHERS).sort()).toEqual([
      "arxiv",
      "crossref",
      "exa",
      "firecrawl",
      "github",
      "hn",
      "lobsters",
      "producthunt",
      "rss",
      "youtube",
    ]);
    expect(DEFAULT_TYPE_LIMITS.firecrawl).toMatchObject({ concurrency: 2 });
    expect(DEFAULT_TYPE_LIMITS.firecrawl?.minIntervalMs).toBeGreaterThanOrEqual(6000);
  });
});

describe("createLimiter", () => {
  it("never exceeds its concurrency and keeps submission order", async () => {
    const limiter = createLimiter(2);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    await Promise.all(
      [0, 1, 2, 3, 4].map((n) =>
        limiter.run(async () => {
          started.push(n);
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 3));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it("spaces task starts by the minimum interval", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = createLimiter(1, {
      minIntervalMs: 100,
      clock: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });
    await limiter.run(async () => {});
    await limiter.run(async () => {});
    await limiter.run(async () => {});
    expect(waits).toEqual([100, 100]);
  });

  it("releases its slot when a task throws", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(limiter.run(async () => "next")).resolves.toBe("next");
  });
});
