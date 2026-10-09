import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/fetch/feedParser.js";
import { createHttpClient } from "../src/http.js";
import {
  feedActivity,
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
  const base = {
    hasFeed: true,
    https: true,
    hasTitle: true,
    latestAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    items30d: 8,
    now: NOW,
  };

  it("rates a fresh feed with steady posting Excellent", () => {
    const result = scorePreview(base);
    expect(result.score).toBe(5);
    expect(result.label).toBe("Excellent");
    expect(result.reason).toBe("Valid feed, 8 posts in the last 30 days, latest 2 days ago.");
  });

  it("scores a flood below steady posting", () => {
    const flood = scorePreview({ ...base, items30d: 90 });
    expect(flood.score).toBeLessThan(5);
    expect(flood.reason).toContain("flood");
  });

  it("scores a dormant feed Poor to Fair and a single post a month lower than steady", () => {
    const dormant = scorePreview({
      ...base,
      latestAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
      items30d: 0,
    });
    expect(dormant.score).toBeLessThan(3);
    expect(dormant.reason).toContain("no posts in the last 30 days");
    expect(scorePreview({ ...base, items30d: 1 }).score).toBeLessThan(5);
  });

  it("caps a page without a feed at 3", () => {
    const page = scorePreview({
      hasFeed: false,
      https: true,
      hasTitle: true,
      latestAt: null,
      items30d: null,
      now: NOW,
    });
    expect(page.score).toBeLessThanOrEqual(3);
    expect(page.reason).toContain("No feed found");
  });

  it("marks down plain http", () => {
    expect(scorePreview({ ...base, https: false }).score).toBeLessThan(5);
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
    });
    expect(preview.score).toBeGreaterThanOrEqual(4.5);
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
    expect(preview.score).toBeLessThanOrEqual(3);
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
