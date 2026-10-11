import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GeneralFeeds, PodcastRequest } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HttpClient } from "../src/http.js";
import { titleNames } from "../src/podcast/episode.js";
import { generateEpisode, mergeGroups, storyShares } from "../src/podcast/generate.js";
import { PodcastError } from "../src/podcast/types.js";
import {
  dayAgo,
  FakeScriptWriter,
  makeDigest,
  NOW,
  tempRoot,
  writeDigest,
} from "./podcast-fixtures.js";

const MIXED: PodcastRequest = {
  topic_ids: ["design", "ui-craft", "world"],
  length_minutes: 5,
  format: "readout",
  window_days: 7,
  tone: "neutral",
};

const feed = (id: string) => [{ id: "npr", name: "NPR", feed_url: `https://npr.test/${id}` }];
const FEEDS: GeneralFeeds = {
  version: 1,
  topics: {
    world: feed("world"),
    business: feed("business"),
    technology: feed("technology"),
    science: feed("science"),
    culture: feed("culture"),
    sports: feed("sports"),
  },
};

const TITLES = [
  "Magnitude 6.1 earthquake strikes Izmir coast in Turkey",
  "Leaders reach climate summit deal in Geneva after talks",
  "Volcano in Iceland erupts near Reykjanes town",
];

function rss(): string {
  const items = TITLES.map((title, i) => {
    const date = new Date(NOW.getTime() - (i + 1) * 3_600_000).toUTCString();
    return `<item><title>${title}</title><link>https://npr.test/s${i}</link><pubDate>${date}</pubDate><description>${title} today.</description></item>`;
  });
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${items.join("")}</channel></rss>`;
}

function http(bodies: Record<string, string>): HttpClient {
  return {
    async fetchText(url) {
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

let ctx: Awaited<ReturnType<typeof tempRoot>>;
beforeEach(async () => {
  ctx = await tempRoot();
  await mkdir(join(ctx.root, "config"), { recursive: true });
  await writeFile(join(ctx.root, "config", "general-feeds.json"), JSON.stringify(FEEDS), "utf8");
});
afterEach(async () => {
  await ctx.cleanup();
});

async function designDigest(): Promise<void> {
  const day = dayAgo(1);
  await writeDigest(
    ctx.root,
    makeDigest(day.id, day.at, [
      { n: 1, section: "design", category: "taste_and_design_philosophy", score: 0.9 },
      { n: 2, section: "ui-craft", category: "taste_and_design_philosophy", score: 0.8 },
      { n: 3, section: "design", category: "taste_and_design_philosophy", score: 0.7 },
    ]),
  );
}

describe("storyShares", () => {
  it("shares in proportion to the topics each group has, one at least each", () => {
    expect(storyShares(10, 2, 1)).toEqual([7, 3]);
    expect(storyShares(10, 1, 1)).toEqual([5, 5]);
    expect(storyShares(10, 1, 9)).toEqual([1, 9]);
    expect(storyShares(2, 1, 5)).toEqual([1, 1]);
    expect(storyShares(10, 3, 0)).toEqual([10, 0]);
    expect(storyShares(10, 0, 3)).toEqual([0, 10]);
  });
});

describe("mergeGroups", () => {
  it("alternates so the strongest of each group lead", () => {
    expect(mergeGroups(["b1", "b2", "b3"], ["g1", "g2", "g3"], 6, [3, 3])).toEqual([
      "b1",
      "g1",
      "b2",
      "g2",
      "b3",
      "g3",
    ]);
  });

  it("gives the room a short group leaves to the other", () => {
    expect(mergeGroups(["b1"], ["g1", "g2", "g3", "g4"], 5, [2, 3])).toEqual([
      "b1",
      "g1",
      "g2",
      "g3",
      "g4",
    ]);
    expect(mergeGroups(["b1", "b2", "b3", "b4"], ["g1"], 5, [2, 3])).toEqual([
      "b1",
      "g1",
      "b2",
      "b3",
      "b4",
    ]);
  });

  it("never exceeds the maximum", () => {
    expect(mergeGroups(["b1", "b2", "b3"], ["g1", "g2", "g3"], 4, [2, 2])).toHaveLength(4);
  });
});

describe("a mixed episode", () => {
  it("reads briefings for section ids and feeds for general ids, and merges them", async () => {
    await designDigest();
    const writer = new FakeScriptWriter();
    const result = await generateEpisode({
      root: ctx.root,
      request: MIXED,
      now: NOW,
      makeWriter: () => writer,
      http: http({ "https://npr.test/world": rss() }),
      dryRun: true,
    });
    expect(result.feeds).toEqual({ ok: 1, failed: 0 });
    expect(result.digests).toBe(1);
    expect(result.empty_topics).toEqual([]);
    const sections = result.episode.sources.map((s) => s.source);
    expect(sections).toContain("NPR");
    expect(sections).toContain("Example Wire");
    expect(result.episode.request.topic_ids).toEqual(["design", "ui-craft", "world"]);
    expect(result.episode.title).toBe("Design and World");
  });

  it("works under the general audience too", async () => {
    await designDigest();
    const result = await generateEpisode({
      root: ctx.root,
      request: { ...MIXED, audience: "general" },
      now: NOW,
      makeWriter: () => new FakeScriptWriter(),
      http: http({ "https://npr.test/world": rss() }),
      dryRun: true,
    });
    expect(result.feeds?.ok).toBe(1);
    expect(result.digests).toBe(1);
  });

  it("warns and builds from the feeds when the briefings hold nothing for the sections", async () => {
    const result = await generateEpisode({
      root: ctx.root,
      request: MIXED,
      now: NOW,
      makeWriter: () => new FakeScriptWriter(),
      http: http({ "https://npr.test/world": rss() }),
      dryRun: true,
    });
    expect(result.empty_topics).toEqual(["design", "ui-craft"]);
    expect(result.episode.sources.every((s) => s.source === "NPR")).toBe(true);
  });

  it("warns and builds from the briefings when no feed can be read", async () => {
    await designDigest();
    const result = await generateEpisode({
      root: ctx.root,
      request: MIXED,
      now: NOW,
      makeWriter: () => new FakeScriptWriter(),
      http: http({}),
      dryRun: true,
    });
    expect(result.empty_topics).toEqual(["world"]);
    expect(result.feeds).toBeUndefined();
  });

  it("fails naming the topics when both groups find nothing", async () => {
    const writer = new FakeScriptWriter();
    const run = generateEpisode({
      root: ctx.root,
      request: MIXED,
      now: NOW,
      makeWriter: () => writer,
      http: http({}),
      dryRun: true,
    });
    await expect(run).rejects.toBeInstanceOf(PodcastError);
    await expect(run).rejects.toThrow(/Design, Design Engineering and World/);
    expect(writer.calls).toHaveLength(0);
  });
});

describe("titleNames", () => {
  it("names the ids the new chips send once and sensibly", () => {
    expect(titleNames(["design", "ui-craft", "ai", "tech", "world"])).toEqual([
      "Design",
      "AI",
      "Technology",
      "World",
    ]);
    expect(titleNames(["tech", "technology"])).toEqual(["Technology"]);
    expect(titleNames(["audio_interfaces"])).toEqual(["Audio interfaces"]);
  });
});
