import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type GeneralFeeds, type PodcastRequest, parseEpisodeFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HttpClient } from "../src/http.js";
import { pickStories, selectGeneralStories, topStoryCount } from "../src/podcast/general.js";
import { generateEpisode } from "../src/podcast/generate.js";
import { planPodcast } from "../src/podcast/plan.js";
import { PodcastError } from "../src/podcast/types.js";
import { FakeScriptWriter, NOW, tempRoot } from "./podcast-fixtures.js";

const GENERAL: PodcastRequest = {
  topic_ids: ["world", "business"],
  length_minutes: 5,
  format: "readout",
  window_days: 2,
  tone: "neutral",
  audience: "general",
};

interface Entry {
  title: string;
  link: string;
  hoursAgo: number;
  description?: string;
}

function rss(entries: readonly Entry[]): string {
  const items = entries.map((e) => {
    const date = new Date(NOW.getTime() - e.hoursAgo * 3_600_000).toUTCString();
    return `<item><title>${e.title}</title><link>${e.link}</link><pubDate>${date}</pubDate><description>${e.description ?? ""}</description></item>`;
  });
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items.join("")}</channel></rss>`;
}

/** A client that serves a fixed body per URL and fails for any URL it does not know. */
function fakeHttp(bodies: Record<string, string>, calls: string[] = []): HttpClient {
  return {
    async fetchText(url) {
      calls.push(url);
      const text = bodies[url];
      if (text === undefined) throw new Error(`HTTP 503 for ${url}`);
      return { url, status: 200, contentType: "text/xml", text };
    },
    async getJson() {
      throw new Error("not used");
    },
    async postJson() {
      throw new Error("not used");
    },
  };
}

const FEEDS: GeneralFeeds = {
  version: 1,
  topics: {
    world: [
      { id: "npr", name: "NPR", feed_url: "https://npr.test/world" },
      { id: "bbc", name: "BBC News", feed_url: "https://bbc.test/world" },
      { id: "abc-news", name: "ABC News", feed_url: "https://abc.test/world" },
    ],
    business: [
      { id: "npr", name: "NPR", feed_url: "https://npr.test/business" },
      { id: "cbs-news", name: "CBS News", feed_url: "https://cbs.test/business" },
    ],
    technology: [{ id: "npr", name: "NPR", feed_url: "https://npr.test/tech" }],
    science: [{ id: "npr", name: "NPR", feed_url: "https://npr.test/science" }],
    culture: [{ id: "npr", name: "NPR", feed_url: "https://npr.test/culture" }],
    sports: [{ id: "npr", name: "NPR", feed_url: "https://npr.test/sports" }],
  },
};

const QUAKE = "Magnitude 6.1 earthquake strikes Izmir coast in Turkey";
const SUMMIT = "Leaders reach climate summit deal in Geneva after talks";

const BODIES: Record<string, string> = {
  "https://npr.test/world": rss([
    {
      title: QUAKE,
      link: "https://npr.test/quake",
      hoursAgo: 5,
      description: "Rescuers search the rubble in Izmir.",
    },
    {
      title: SUMMIT,
      link: "https://npr.test/summit",
      hoursAgo: 8,
      description: "Delegates agreed a deal.",
    },
    { title: "Old news from last week", link: "https://npr.test/old", hoursAgo: 24 * 6 },
  ]),
  "https://bbc.test/world": rss([
    {
      title: "Earthquake of magnitude 6.1 strikes Izmir coast, Turkey",
      link: "https://bbc.test/quake",
      hoursAgo: 4,
    },
    {
      title: "Leaders reach climate summit deal after Geneva talks",
      link: "https://bbc.test/summit",
      hoursAgo: 9,
    },
  ]),
  "https://abc.test/world": rss([
    {
      title: "Turkey earthquake: magnitude 6.1 strikes Izmir coast",
      link: "https://abc.test/quake",
      hoursAgo: 3,
    },
    {
      title: "Volcano in Iceland erupts near Reykjanes town",
      link: "https://abc.test/volcano",
      hoursAgo: 2,
    },
  ]),
  "https://npr.test/business": rss([
    {
      title: "Central bank holds interest rates steady in Frankfurt",
      link: "https://npr.test/rates",
      hoursAgo: 1,
    },
    {
      title: "Retailer Marlow reports quarterly profit rise",
      link: "https://npr.test/marlow",
      hoursAgo: 12,
    },
  ]),
  "https://cbs.test/business": rss([
    {
      title: "Retailer Marlow profit rises in quarterly report",
      link: "https://cbs.test/marlow",
      hoursAgo: 11,
    },
  ]),
};

function deps(over: Partial<Parameters<typeof selectGeneralStories>[0]> = {}) {
  return {
    root: "/unused",
    plan: planPodcast(GENERAL),
    now: NOW,
    http: fakeHttp(BODIES),
    feeds: FEEDS,
    ...over,
  };
}

let ctx: Awaited<ReturnType<typeof tempRoot>>;
beforeEach(async () => {
  ctx = await tempRoot();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("selectGeneralStories", () => {
  it("clusters across outlets and ranks by coverage, then recency", async () => {
    const { stories, matched, empty_topics } = await selectGeneralStories(deps());
    const titles = stories.map((s) => s.headline);
    // Three outlets carried the quake, two the summit and two the retailer; coverage ranks them.
    expect(titles[0]).toMatch(/earthquake|Earthquake/);
    expect(stories[0]?.source.split(", ").sort()).toEqual(["ABC News", "BBC News", "NPR"]);
    expect(titles[1]).toMatch(/climate summit/);
    // 5 minutes of readout has room for 10 stories; 3 of them open the episode, the retailer
    // (two outlets) being the third.
    expect(topStoryCount(planPodcast(GENERAL).max_stories)).toBe(3);
    expect(titles[2]).toMatch(/Marlow/);
    expect(titles.some((t) => /Old news/.test(t))).toBe(false);
    expect(new Set(stories.map((s) => s.item_id)).size).toBe(stories.length);
    expect(matched).toBe(stories.length);
    expect(empty_topics).toEqual([]);
  });

  it("keeps only the items inside the request window", async () => {
    const wide = await selectGeneralStories(
      deps({ plan: planPodcast({ ...GENERAL, window_days: 7 }) }),
    );
    expect(wide.stories.some((s) => /Old news/.test(s.headline))).toBe(true);
    const narrow = await selectGeneralStories(deps());
    expect(narrow.stories.some((s) => /Old news/.test(s.headline))).toBe(false);
  });

  it("uses the feed's title and description as the story text, and lists outlets as the source", async () => {
    const { stories } = await selectGeneralStories(deps());
    const volcano = stories.find((s) => /Volcano/.test(s.headline));
    expect(volcano?.source).toBe("ABC News");
    expect(volcano?.section).toBe("world");
    // No description in the feed: the title stands in as the summary.
    expect(volcano?.summary).toBe(volcano?.headline);
    const quake = stories.find((s) => /rthquake/.test(s.headline));
    expect(quake?.summary).toMatch(/Rescuers search the rubble/);
  });

  it("reads each feed once and works when one feed fails", async () => {
    const calls: string[] = [];
    const bodies = { ...BODIES };
    delete bodies["https://bbc.test/world"];
    const result = await selectGeneralStories(deps({ http: fakeHttp(bodies, calls) }));
    expect(result.feeds_failed).toBe(1);
    expect(result.feeds_ok).toBe(4);
    expect(calls).toHaveLength(5);
    expect(new Set(calls).size).toBe(5);
  });

  it("fails with a plain message when every feed fails, and does not read briefings", async () => {
    const attempt = selectGeneralStories(deps({ http: fakeHttp({}) }));
    await expect(attempt).rejects.toBeInstanceOf(PodcastError);
    await expect(attempt).rejects.toThrow(/No news feed could be read for World and Business/);
  });

  it("names a topic whose feeds hold nothing in the window and builds from the rest", async () => {
    const bodies = { ...BODIES };
    bodies["https://npr.test/business"] = rss([]);
    bodies["https://cbs.test/business"] = rss([]);
    const result = await selectGeneralStories(deps({ http: fakeHttp(bodies) }));
    expect(result.empty_topics).toEqual(["business"]);
    expect(result.stories.every((s) => s.section === "world")).toBe(true);
  });

  it("fails when fewer stories than a short episode needs are found", async () => {
    const bodies = {
      "https://npr.test/world": rss([
        { title: QUAKE, link: "https://npr.test/quake", hoursAgo: 5 },
      ]),
    };
    await expect(selectGeneralStories(deps({ http: fakeHttp(bodies) }))).rejects.toThrow(
      /Only 1 story in the news feeds for World and Business; an episode needs at least 3/,
    );
  });
});

describe("pickStories", () => {
  const candidate = (id: string, topic: string, coverage: number, minutes: number) =>
    ({
      item: {
        id,
        coverage,
        published_at: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
        fetched_at: NOW.toISOString(),
      },
      topics: new Set([topic]),
      outlets: new Set(["x"]),
      coverage,
    }) as unknown as Parameters<typeof pickStories>[0][number];

  it("opens with the highest coverage across topics, then deals topics round-robin", () => {
    const all = [
      candidate("a1", "world", 1, 10),
      candidate("a2", "world", 1, 20),
      candidate("a3", "world", 1, 30),
      candidate("b1", "business", 4, 40),
      candidate("b2", "business", 1, 5),
      candidate("c1", "culture", 3, 50),
    ];
    const picked = pickStories(all, ["world", "business", "culture"], 5).map((c) => c.item.id);
    // 1 top story (round(5 / 4) = 1): b1. The other four slots go to world, business, culture and
    // world again, newest first; the episode then reads topic by topic in the order chosen.
    expect(picked).toEqual(["b1", "a1", "a2", "b2", "c1"]);
  });
});

describe("a general episode", () => {
  it("is written like any episode and parses with the existing parser", async () => {
    await mkdir(join(ctx.root, "config"), { recursive: true });
    await writeFile(join(ctx.root, "config", "general-feeds.json"), JSON.stringify(FEEDS), "utf8");
    const writer = new FakeScriptWriter();
    const result = await generateEpisode({
      root: ctx.root,
      request: GENERAL,
      now: NOW,
      makeWriter: () => writer,
      http: fakeHttp(BODIES),
    });
    expect(result.digests).toBe(0);
    expect(result.feeds).toEqual({ ok: 5, failed: 0 });
    expect(writer.calls).toHaveLength(1);

    const text = await readFile(join(ctx.root, result.relPath), "utf8");
    expect(result.relPath).toMatch(/^Podcasts\/2026\/10\/ep-\d{8}-\d{4}\.md$/);
    const episode = parseEpisodeFile(text);
    expect(episode.title).toBe("World and Business");
    expect(episode.request.audience).toBe("general");
    expect(episode.sources.length).toBeGreaterThan(0);
    expect(episode.sources.some((s) => /NPR|BBC News|ABC News|CBS News/.test(s.source))).toBe(true);
    expect(text).toContain("## Sources");
  });

  it("fails with the plain message when no feed can be read, without calling the writer", async () => {
    await mkdir(join(ctx.root, "config"), { recursive: true });
    await writeFile(join(ctx.root, "config", "general-feeds.json"), JSON.stringify(FEEDS), "utf8");
    const writer = new FakeScriptWriter();
    await expect(
      generateEpisode({
        root: ctx.root,
        request: GENERAL,
        now: NOW,
        makeWriter: () => writer,
        http: fakeHttp({}),
      }),
    ).rejects.toThrow(/No news feed could be read/);
    expect(writer.calls).toHaveLength(0);
  });
});
