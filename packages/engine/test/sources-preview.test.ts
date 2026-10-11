import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/fetch/feedParser.js";
import { createHttpClient } from "../src/http.js";
import {
  feedActivity,
  PAGE_ONLY_TRUST_CAP,
  PreviewError,
  parsePageMeta,
  previewSource,
  registrableName,
  scorePreview,
} from "../src/sources/preview.js";
import { fakeFetch } from "./fetch-helpers.js";

const NOW = new Date("2026-10-09T12:00:00Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toUTCString();

function rss(title: string | null, ages: number[]): string {
  const items = ages
    .map(
      (age, i) =>
        `<item><title>Post ${i}</title><link>https://news.example.com/p/${i}</link><guid>p${i}</guid><pubDate>${daysAgo(age)}</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel>${title ? `<title>${title}</title>` : ""}<link>https://news.example.com/</link>${items}</channel></rss>`;
}

const PAGE = `<!doctype html><html><head><title>Example News | Home</title>
<meta property="og:site_name" content="Example News Network">
<meta property="og:image" content="/img/share.png">
<link rel="icon" href="/static/icon.png">
<link rel="alternate" type="application/rss+xml" title="Example" href="/feed.xml">
</head><body></body></html>`;

describe("parsePageMeta", () => {
  it("reads site name, icon and share image, resolving relative addresses", () => {
    const meta = parsePageMeta(PAGE, "https://news.example.com/blog/");
    expect(meta).toMatchObject({
      siteName: "Example News Network",
      title: "Example News | Home",
      iconUrl: "https://news.example.com/static/icon.png",
      imageUrl: "https://news.example.com/img/share.png",
    });
  });

  it("falls back to an apple touch icon and ignores non-web addresses", () => {
    const html = `<head><link rel="apple-touch-icon" href="/t.png"><meta property="og:image" content="data:image/png;base64,AAA"></head>`;
    const meta = parsePageMeta(html, "https://a.example/");
    expect(meta.iconUrl).toBe("https://a.example/t.png");
    expect(meta.imageUrl).toBeUndefined();
  });

  it("tolerates a page with no head at all", () => {
    expect(parsePageMeta("<p>hi</p>", "https://a.example/")).toMatchObject({
      siteName: undefined,
      iconUrl: undefined,
    });
  });
});

describe("registrableName", () => {
  it("names the outlet from the host", () => {
    expect(registrableName("www.stripe.com")).toBe("Stripe");
    expect(registrableName("blog.example.co.uk")).toBe("Example");
    expect(registrableName("localhost")).toBe("Localhost");
  });
});

describe("feedActivity", () => {
  it("finds the newest post and counts the last 30 days", () => {
    const feed = parseFeed(rss("T", [2, 10, 29, 45, 200]), "https://news.example.com/feed.xml");
    const activity = feedActivity(feed, NOW);
    expect(activity.items30d).toBe(3);
    expect(activity.latestAt).toBe(new Date(NOW.getTime() - 2 * 86_400_000).toISOString());
  });

  it("ignores undated entries", () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>T</title><item><title>x</title><guid>1</guid></item></channel></rss>`,
    );
    expect(feedActivity(feed, NOW)).toEqual({ latestAt: null, items30d: 0 });
  });
});

describe("scorePreview", () => {
  const ago = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();
  const base = {
    hasFeed: true,
    https: true,
    hasTitle: true,
    named: true,
    latestAt: ago(2),
    items30d: 8,
    now: NOW,
  };
  const page = { ...base, hasFeed: false, latestAt: null, items30d: null };

  it("rates a fresh feed with steady posting 3 of 3, Excellent, with every part full", () => {
    expect(scorePreview(base)).toEqual({
      score: 3,
      label: "Excellent",
      parts: { health: 1, quality: 1, trust: 1 },
      reason: "Valid feed, 8 posts in the last 30 days, latest 2 days ago.",
    });
  });

  it("reads health from the feed and how fresh its newest post is", () => {
    const health = (latestAt: string | null) => scorePreview({ ...base, latestAt }).parts.health;
    expect(health(ago(2))).toBe(1);
    expect(health(ago(20))).toBe(0.82);
    expect(health(ago(60))).toBe(0.58);
    expect(health(ago(400))).toBe(0.4);
    expect(health(null)).toBe(0.4);
    expect(scorePreview(page).parts.health).toBe(0);
  });

  it("reads quality from how often it posts and whether it has a title", () => {
    const quality = (items30d: number | null, hasTitle = true) =>
      scorePreview({ ...base, items30d, hasTitle }).parts.quality;
    expect(quality(8)).toBe(1);
    expect(quality(20)).toBe(1);
    expect(quality(1)).toBe(0.52);
    expect(quality(30)).toBe(0.6);
    expect(quality(90)).toBe(0.36);
    expect(quality(0)).toBe(0.2);
    expect(quality(8, false)).toBe(0.8);
    // What a feed shows counts only with a feed.
    expect(scorePreview({ ...page, items30d: 8 }).parts.quality).toBe(0.2);
  });

  it("reads trust from https and a site that names itself, capped for a page with no feed", () => {
    const trust = (change: Partial<typeof base>) =>
      scorePreview({ ...base, ...change }).parts.trust;
    expect(trust({})).toBe(1);
    expect(trust({ named: false })).toBe(0.6);
    expect(trust({ https: false })).toBe(0.4);
    expect(trust({ https: false, named: false })).toBe(0);
    expect(PAGE_ONLY_TRUST_CAP).toBe(0.6);
    expect(scorePreview(page).parts.trust).toBe(0.6);
    expect(scorePreview({ ...page, https: false }).parts.trust).toBe(0.4);
  });

  it("scores a page without a feed Poor", () => {
    const result = scorePreview(page);
    expect(result).toMatchObject({
      score: 0.8,
      label: "Poor",
      parts: { health: 0, quality: 0.2, trust: 0.6 },
    });
    expect(result.reason).toContain("No feed found");
  });

  it("scores a flood, a single post and a dormant feed below steady posting", () => {
    const flood = scorePreview({ ...base, items30d: 90 });
    expect(flood).toMatchObject({ score: 2.4, label: "Good" });
    expect(flood.reason).toContain("flood");
    expect(scorePreview({ ...base, items30d: 1 })).toMatchObject({ score: 2.5, label: "Good" });
    const dormant = scorePreview({ ...base, latestAt: ago(400), items30d: 0 });
    expect(dormant).toMatchObject({ score: 1.6, label: "Fair" });
    expect(dormant.reason).toContain("no posts in the last 30 days");
  });

  it("marks down plain http, and the parts add up to the score", () => {
    const http = scorePreview({ ...base, https: false });
    expect(http).toMatchObject({ score: 2.4, label: "Good" });
    for (const input of [base, page, { ...base, latestAt: ago(20), items30d: 1, named: false }]) {
      const { score, parts } = scorePreview(input);
      expect(score).toBe(Math.round((parts.health + parts.quality + parts.trust) * 10) / 10);
    }
  });
});

function http(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch({
    "https://news.example.com/favicon.ico": { status: 404 },
    ...routes,
  });
  return { fake, deps: { http: createHttpClient({ fetchImpl: fake, retries: 0 }), now: NOW } };
}

describe("previewSource", () => {
  it("previews a page that advertises a feed", async () => {
    const { deps } = http({
      "https://news.example.com/": PAGE,
      "https://news.example.com/feed.xml": rss("Example Feed", [1, 5, 9, 20]),
    });
    const preview = await previewSource("https://news.example.com/", deps);
    expect(preview).toMatchObject({
      name: "Example Feed",
      host: "news.example.com",
      kind: "feed",
      feed_url: "https://news.example.com/feed.xml",
      favicon_url: "https://news.example.com/static/icon.png",
      thumbnail_url: "https://news.example.com/img/share.png",
      items_30d: 4,
      score: 3,
      score_label: "Excellent",
      score_parts: { health: 1, quality: 1, trust: 1 },
    });
    expect(preview.latest_at).toBe(new Date(NOW.getTime() - 86_400_000).toISOString());
  });

  it("names the outlet from og:site_name when the feed has no title", async () => {
    const { deps } = http({
      "https://news.example.com/": PAGE,
      "https://news.example.com/feed.xml": rss(null, [3]),
    });
    expect((await previewSource("https://news.example.com/", deps)).name).toBe(
      "Example News Network",
    );
  });

  it("falls back to /favicon.ico when it answers", async () => {
    const { deps } = http({
      "https://news.example.com/": "<html><head><title>Plain</title></head></html>",
      "https://news.example.com/favicon.ico": "ico",
    });
    const preview = await previewSource("https://news.example.com/", deps);
    expect(preview.favicon_url).toBe("https://news.example.com/favicon.ico");
    expect(preview.kind).toBe("page");
    expect(preview.feed_url).toBeNull();
    expect(preview.items_30d).toBeNull();
    // A title of its own, but no feed and no name beyond the one guessed from the host.
    expect(preview).toMatchObject({
      score: 0.8,
      score_label: "Poor",
      score_parts: { health: 0, quality: 0.2, trust: 0.6 },
    });
    expect(preview.name).toBe("Example");
  });

  it("takes a feed address directly", async () => {
    const { deps } = http({
      "https://news.example.com/feed.xml": rss("Direct", [2, 4]),
      "https://news.example.com/": PAGE,
    });
    const preview = await previewSource("https://news.example.com/feed.xml", deps);
    expect(preview).toMatchObject({ kind: "feed", name: "Direct", items_30d: 2 });
    expect(preview.favicon_url).toBe("https://news.example.com/static/icon.png");
  });

  it("reports an unreachable address", async () => {
    const { deps } = http({ "https://news.example.com/": { status: 404 } });
    await expect(previewSource("https://news.example.com/", deps)).rejects.toMatchObject({
      name: "PreviewError",
      code: "unreachable",
    });
  });

  it("reports a timeout", async () => {
    const slow = async (): Promise<Response> => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    const deps = { http: createHttpClient({ fetchImpl: slow, retries: 0 }), now: NOW };
    const error = await previewSource("https://news.example.com/", deps).catch((e) => e);
    expect(error).toBeInstanceOf(PreviewError);
    expect(error.code).toBe("timeout");
  });

  it("never touches the network when given a fake client", async () => {
    const { fake, deps } = http({
      "https://news.example.com/": PAGE,
      "https://news.example.com/feed.xml": rss("T", [1]),
    });
    await previewSource("https://news.example.com/", deps);
    expect(fake.calls.every((call) => call.startsWith("https://news.example.com/"))).toBe(true);
  });
});
