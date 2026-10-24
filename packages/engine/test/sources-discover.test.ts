import type { SourcesFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/fetch/feedParser.js";
import { buildSourceFromUrl } from "../src/sources/addSource.js";
import {
  classifyLinkKind,
  discoverFeed,
  extractAnchorFeedCandidates,
  extractFeedLinks,
  probeUrls,
  resolveYoutubeChannel,
} from "../src/sources/discover.js";
import { discoverAll } from "../src/sources/discoverAll.js";
import { fakeFetch, fixture, makeDeps, makeSource } from "./fetch-helpers.js";

const RSS = fixture("fetch-rss2-comeau.xml");
const http = (routes: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(routes);
  return { fake, deps: { http: makeDeps(fake).http } };
};

describe("extractFeedLinks", () => {
  const links = extractFeedLinks(
    fixture("sources-page-with-feeds.html"),
    "https://example.com/blog/",
  );

  it("finds rss and atom alternates, resolving relative links", () => {
    expect(links.map((l) => l.href)).toEqual([
      "https://example.com/feed.atom",
      "https://feeds.example.com/studio.xml",
      "https://example.com/comments/feed.xml",
    ]);
    expect(links[0]).toMatchObject({ format: "atom", title: "Example Studio" });
    expect(links[1]?.format).toBe("rss");
  });

  it("ignores json feeds, language alternates, and pages without feed links", () => {
    expect(links.some((l) => l.href.includes("feed.json"))).toBe(false);
    expect(links.some((l) => l.href.includes("/sv/"))).toBe(false);
    expect(extractFeedLinks(fixture("sources-page-no-feed.html"), "https://example.com")).toEqual(
      [],
    );
  });

  it("puts comment feeds last", () => {
    expect(links.at(-1)?.title).toBe("Example Studio comments");
  });

  it("tolerates broken markup", () => {
    expect(
      extractFeedLinks(
        "<link rel=alternate type=application/rss+xml href=/f.xml><p>unclosed",
        "https://x.test/",
      ),
    ).toEqual([{ href: "https://x.test/f.xml", title: undefined, format: "rss" }]);
  });
});

describe("probeUrls", () => {
  it("probes the standard paths at the site root", () => {
    expect(probeUrls("https://example.com")).toEqual([
      "https://example.com/feed",
      "https://example.com/rss.xml",
      "https://example.com/atom.xml",
      "https://example.com/feed.xml",
      "https://example.com/rss",
      "https://example.com/atom",
      "https://example.com/index.xml",
    ]);
  });

  it("tries the section path first for section pages and never repeats a URL", () => {
    const urls = probeUrls("https://example.com/blog/");
    expect(urls[0]).toBe("https://example.com/blog/feed");
    expect(urls).toContain("https://example.com/feed");
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("classifyLinkKind", () => {
  const roundup = parseFeed(
    `<rss version="2.0"><channel>${Array.from({ length: 6 }, (_, i) => `<item><title>t${i}</title><link>https://site${i}.example/post</link></item>`).join("")}</channel></rss>`,
  );

  it("labels a feed whose entries mostly point off-site as a link roundup", () => {
    expect(classifyLinkKind(roundup, "https://digest.example/feed")).toBe("newsletter-link");
  });

  it("does not label a feed of its own articles, or a feed too small to judge", () => {
    const own = parseFeed(
      `<rss version="2.0"><channel>${Array.from({ length: 6 }, (_, i) => `<item><title>t${i}</title><link>https://blog.example.com/p${i}</link></item>`).join("")}</channel></rss>`,
    );
    expect(classifyLinkKind(own, "https://example.com/feed")).toBeUndefined();
    expect(
      classifyLinkKind(
        parseFeed(
          `<rss version="2.0"><channel><item><title>a</title><link>https://other.example/a</link></item></channel></rss>`,
        ),
        "https://digest.example/feed",
      ),
    ).toBeUndefined();
  });

  it("does not label a blog that moved domains: its off-site links all go to one host", () => {
    const moved = parseFeed(
      `<rss version="2.0"><channel>${Array.from({ length: 6 }, (_, i) => `<item><title>t${i}</title><link>https://new-home.example/p${i}</link></item>`).join("")}</channel></rss>`,
    );
    expect(classifyLinkKind(moved, "https://old-home.example/rss.xml")).toBeUndefined();
  });
});

describe("extractAnchorFeedCandidates", () => {
  const html = `<html><body>
    <a href="/rss.xml">RSS</a>
    <a href="http://us14.campaign-archive1.com/feed?u=abc&amp;id=123">Subscribe</a>
    <a href="/posts/launch?utm_source=rss">Launch post</a>
    <a href="/comments/feed">Comment feed</a>
    <a href="mailto:hello@example.com">Mail</a>
    <a href="/atom.xml">Atom</a>
    <a href="/feed/">Feed</a>
    <a href="/rss.xml">RSS again</a>
  </body></html>`;

  it("returns feed-looking links from the page body, skipping articles, comments and mail", () => {
    expect(extractAnchorFeedCandidates(html, "https://example.com/blog/")).toEqual([
      "https://example.com/rss.xml",
      "http://us14.campaign-archive1.com/feed?u=abc&id=123",
      "https://example.com/atom.xml",
    ]);
  });

  it("returns nothing for a page with no such links", () => {
    expect(
      extractAnchorFeedCandidates("<a href='/about'>About</a>", "https://example.com"),
    ).toEqual([]);
  });
});

describe("discoverFeed", () => {
  it("follows a feed link advertised in the page head and verifies it", async () => {
    const { deps, fake } = http({
      "https://example.com/": fixture("sources-page-with-feeds.html"),
      "https://example.com/feed.atom": fixture("fetch-atom-willison.xml"),
    });
    const result = await discoverFeed("https://example.com/", deps);
    expect(result).toMatchObject({
      status: "feed",
      feedUrl: "https://example.com/feed.atom",
      format: "atom",
      via: "link",
    });
    expect(fake.calls).toEqual(["https://example.com/", "https://example.com/feed.atom"]);
  });

  it("skips an advertised feed that is broken and tries the next one", async () => {
    const { deps } = http({
      "https://example.com/": fixture("sources-page-with-feeds.html"),
      "https://example.com/feed.atom": { status: 500 },
      "https://feeds.example.com/studio.xml": RSS,
    });
    expect(await discoverFeed("https://example.com/", deps)).toMatchObject({
      status: "feed",
      feedUrl: "https://feeds.example.com/studio.xml",
      via: "link",
    });
  });

  it("probes common paths when the page advertises nothing", async () => {
    const { deps, fake } = http({
      "https://example.com/": fixture("sources-page-no-feed.html"),
      "https://example.com/feed.xml": RSS,
    });
    const result = await discoverFeed("https://example.com/", deps);
    expect(result).toMatchObject({
      status: "feed",
      feedUrl: "https://example.com/feed.xml",
      via: "probe",
    });
    expect(fake.calls.slice(0, 5)).toEqual([
      "https://example.com/",
      "https://example.com/feed",
      "https://example.com/rss.xml",
      "https://example.com/atom.xml",
      "https://example.com/feed.xml",
    ]);
  });

  it("rejects HTML that a single-page app serves for every path", async () => {
    // One catch-all route: every probe gets a 200 HTML page, like a client-rendered site.
    const { deps } = http({ "https://spa.example/": fixture("sources-page-no-feed.html") });
    const result = await discoverFeed("https://spa.example/", deps);
    expect(result.status).toBe("none");
    expect(result.requests).toBe(1 + probeUrls("https://spa.example/").length);
  });

  it("accepts a page that is itself a feed", async () => {
    const { deps } = http({ "https://example.com/feed": RSS });
    expect(await discoverFeed("https://example.com/feed", deps)).toMatchObject({
      status: "feed",
      via: "page",
      feedUrl: "https://example.com/feed",
    });
  });

  it("tries a hint first and stops there when it checks out", async () => {
    const { deps, fake } = http({ "https://example.com/hint.xml": RSS });
    expect(
      await discoverFeed("https://example.com/", deps, "https://example.com/hint.xml"),
    ).toMatchObject({ status: "feed", via: "hint" });
    expect(fake.calls).toEqual(["https://example.com/hint.xml"]);
  });

  it("falls back to the page when the hint is wrong", async () => {
    const { deps } = http({
      "https://example.com/": fixture("sources-page-with-feeds.html"),
      "https://example.com/feed.atom": fixture("fetch-atom-willison.xml"),
    });
    expect(
      await discoverFeed("https://example.com/", deps, "https://example.com/gone.xml"),
    ).toMatchObject({ status: "feed", via: "link" });
  });

  it("labels a roundup feed as newsletter-link", async () => {
    const items = Array.from(
      { length: 6 },
      (_, i) => `<item><title>t${i}</title><link>https://other${i}.example/a</link></item>`,
    ).join("");
    const { deps } = http({
      "https://digest.example/feed": `<rss version="2.0"><channel>${items}</channel></rss>`,
    });
    expect(await discoverFeed("https://digest.example/feed", deps)).toMatchObject({
      status: "feed",
      linkKind: "newsletter-link",
    });
  });

  it("reports a missing page as dead", async () => {
    const { deps } = http({ "https://gone.example/": { status: 404 } });
    expect(await discoverFeed("https://gone.example/", deps)).toMatchObject({
      status: "dead",
      reason: "HTTP 404",
    });
  });

  it("reports a host that no longer resolves as dead", async () => {
    const dns = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND gone.example"), { code: "ENOTFOUND" }),
    });
    const deps = {
      http: makeDeps((async () => {
        throw dns;
      }) as typeof fetch).http,
    };
    expect(await discoverFeed("https://gone.example/", deps)).toMatchObject({
      status: "dead",
      reason: "host does not resolve",
    });
  });

  it("does not call a page dead after a temporary resolver failure", async () => {
    const dns = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("getaddrinfo EAI_AGAIN flaky.example"), { code: "EAI_AGAIN" }),
    });
    const deps = {
      http: makeDeps((async () => {
        throw dns;
      }) as typeof fetch).http,
    };
    expect(await discoverFeed("https://flaky.example/", deps)).toMatchObject({
      status: "blocked",
      reason: "temporary DNS failure",
    });
  });

  it("follows a feed linked from the page body when the head declares none", async () => {
    const page = `<html><body><a href="/feed?u=1&amp;id=2">Subscribe by RSS</a></body></html>`;
    const { deps, fake } = http({
      "https://news.example/feed?u=1&id=2": RSS,
      "https://news.example/": page,
    });
    expect(await discoverFeed("https://news.example/", deps)).toMatchObject({
      status: "feed",
      feedUrl: "https://news.example/feed?u=1&id=2",
      via: "link",
    });
    expect(fake.calls).toEqual(["https://news.example/", "https://news.example/feed?u=1&id=2"]);
  });

  it("calls a blocked page blocked, but still finds a feed at a standard path", async () => {
    const blocked = http({ "https://walled.example/": { status: 403 } });
    expect(await discoverFeed("https://walled.example/", blocked.deps)).toMatchObject({
      status: "blocked",
    });
    const reachable = http({
      "https://walled.example/": { status: 403 },
      "https://walled.example/rss.xml": RSS,
    });
    expect(await discoverFeed("https://walled.example/", reachable.deps)).toMatchObject({
      status: "feed",
      via: "probe",
    });
  });
});

describe("resolveYoutubeChannel", () => {
  it("reads the channel id from the advertised feed link", async () => {
    const { deps } = http({
      "https://www.youtube.com/@Fireship": fixture("sources-youtube-handle.html"),
    });
    expect(await resolveYoutubeChannel("https://www.youtube.com/@Fireship", deps)).toBe(
      "UCsBjURrPoezykLs9EqgamOA",
    );
  });

  it("falls back to the canonical link, then to ids embedded in page data", async () => {
    const idA = `UC${"a".repeat(22)}`;
    const idB = `UC${"b".repeat(22)}`;
    const canonical = `<link rel="canonical" href="https://www.youtube.com/channel/${idA}">`;
    const embedded = `<script>{"externalId":"${idB}"}</script>`;
    expect(
      await resolveYoutubeChannel(
        "https://www.youtube.com/@a",
        http({ "https://www.youtube.com/@a": `<html><head>${canonical}</head></html>` }).deps,
      ),
    ).toBe(idA);
    expect(
      await resolveYoutubeChannel(
        "https://www.youtube.com/@b",
        http({ "https://www.youtube.com/@b": `<html>${embedded}</html>` }).deps,
      ),
    ).toBe(idB);
    expect(
      await resolveYoutubeChannel(
        "https://www.youtube.com/@c",
        http({ "https://www.youtube.com/@c": "<html></html>" }).deps,
      ),
    ).toBeUndefined();
  });

  it("needs no request for a /channel/ address, and asks the resolver, not the 1 MB page, for a handle", async () => {
    const id = `UC${"c".repeat(22)}`;
    const direct = http({});
    expect(await resolveYoutubeChannel(`https://www.youtube.com/channel/${id}`, direct.deps)).toBe(
      id,
    );
    expect(direct.fake.calls).toEqual([]);
    // The page is refused for its size (the preview caps a page at 1 MB); the resolver answers.
    const handle = http({
      "https://www.youtube.com/youtubei/v1/navigation/resolve_url": () =>
        Response.json({ endpoint: { browseEndpoint: { browseId: id } } }),
      "https://www.youtube.com/@big": () => new Response("x".repeat(2 * 1024 * 1024)),
    });
    expect(await resolveYoutubeChannel("https://www.youtube.com/@big", handle.deps)).toBe(id);
  });

  it("sends a consent cookie so the EU interstitial does not hide the page", async () => {
    let cookie: string | null = null;
    const fake = fakeFetch({
      "https://www.youtube.com/@Fireship": (_url, init) => {
        cookie = new Headers(init?.headers).get("cookie");
        return new Response(fixture("sources-youtube-handle.html"));
      },
    });
    await resolveYoutubeChannel("https://www.youtube.com/@Fireship", { http: makeDeps(fake).http });
    expect(cookie).toContain("CONSENT");
  });
});

describe("discoverAll", () => {
  const registry = (): SourcesFile => ({
    version: 1,
    sources: [
      makeSource({
        id: "has-feed-link",
        type: "firecrawl",
        url: "https://a.example/",
        feed_url: null,
      }),
      makeSource({ id: "no-feed", type: "firecrawl", url: "https://b.example/", feed_url: null }),
      makeSource({ id: "gone", type: "firecrawl", url: "https://c.example/", feed_url: null }),
      makeSource({
        id: "hinted",
        type: "firecrawl",
        url: "https://d.example/",
        feed_url: null,
        options: { feed_hint: "https://d.example/rss.xml" },
      }),
      makeSource({
        id: "already",
        type: "rss",
        url: "https://e.example/",
        feed_url: "https://e.example/feed.xml",
      }),
      makeSource({
        id: "api",
        type: "hn",
        url: "https://news.ycombinator.com/show",
        feed_url: "https://hn.algolia.com/api/v1/search_by_date",
      }),
      makeSource({
        id: "manual-off",
        type: "firecrawl",
        url: "https://f.example/",
        feed_url: null,
        enabled: false,
        options: { note: "needs an account" },
      }),
      makeSource({
        id: "channel",
        type: "youtube",
        url: "https://www.youtube.com/@Fireship",
        feed_url: null,
        enabled: false,
        options: { handle: "Fireship", note: "channel id not resolved yet" },
      }),
    ],
  });
  const routes = {
    "https://a.example/": fixture("sources-page-with-feeds.html").replaceAll(
      "https://feeds.example.com/studio.xml",
      "https://a.example/studio.xml",
    ),
    "https://a.example/feed.atom": fixture("fetch-atom-willison.xml"),
    "https://b.example/": fixture("sources-page-no-feed.html"),
    "https://c.example/": { status: 404 },
    "https://d.example/rss.xml": RSS,
    "https://www.youtube.com/@Fireship": fixture("sources-youtube-handle.html"),
  };

  it("upgrades sources with feeds, leaves scrape sources and API sources, and disables dead pages", async () => {
    const { deps } = http(routes);
    const { file, report } = await discoverAll(registry(), deps);
    const byId = Object.fromEntries(file.sources.map((s) => [s.id, s]));
    expect(byId["has-feed-link"]).toMatchObject({
      type: "rss",
      feed_url: "https://a.example/feed.atom",
    });
    expect(byId["no-feed"]).toMatchObject({ type: "firecrawl", feed_url: null, enabled: true });
    expect(byId.gone).toMatchObject({ enabled: false });
    expect(byId.gone?.options.note).toMatch(/dead link: HTTP 404/);
    expect(byId.hinted).toMatchObject({ type: "rss", feed_url: "https://d.example/rss.xml" });
    expect(byId.hinted?.options).not.toHaveProperty("feed_hint");
    expect(byId.already?.feed_url).toBe("https://e.example/feed.xml");
    expect(byId.api?.type).toBe("hn");
    expect(byId["manual-off"]?.enabled).toBe(false);
    expect(Object.fromEntries(report.map((r) => [r.id, r.outcome]))).toMatchObject({
      "has-feed-link": "feed",
      "no-feed": "scrape",
      gone: "dead",
      already: "kept",
      api: "kept",
      "manual-off": "kept",
      channel: "youtube",
    });
  });

  it("resolves YouTube handles to channel ids and enables the source", async () => {
    const { deps } = http(routes);
    const { file } = await discoverAll(registry(), deps);
    const channel = file.sources.find((s) => s.id === "channel");
    expect(channel).toMatchObject({
      enabled: true,
      feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA",
    });
    expect(channel?.options).toMatchObject({
      channel_id: "UCsBjURrPoezykLs9EqgamOA",
      handle: "Fireship",
    });
    expect(channel?.options).not.toHaveProperty("note");
  });

  it("leaves a YouTube source disabled with a reason when the handle page has no id", async () => {
    const { deps } = http({ "https://www.youtube.com/@Fireship": "<html></html>" });
    const { file, report } = await discoverAll(registry(), deps, { only: ["channel"] });
    expect(file.sources.find((s) => s.id === "channel")).toMatchObject({ enabled: false });
    expect(report.find((r) => r.id === "channel")?.outcome).toBe("unresolved");
  });

  it("re-checks sources that already have a feed only when asked", async () => {
    const { deps, fake } = http({
      ...routes,
      "https://e.example/": fixture("sources-page-no-feed.html"),
    });
    await discoverAll(registry(), deps);
    expect(fake.calls.some((url) => url.startsWith("https://e.example"))).toBe(false);
    await discoverAll(registry(), deps, { all: true });
    expect(fake.calls.some((url) => url.startsWith("https://e.example"))).toBe(true);
  });

  it("keeps a known feed when a re-check finds the page down, dead or feedless", async () => {
    for (const page of [{ status: 404 }, { status: 503 }, fixture("sources-page-no-feed.html")]) {
      const { deps } = http({ "https://e.example/": page });
      const { file, report } = await discoverAll(registry(), deps, {
        all: true,
        only: ["already"],
      });
      const kept = file.sources.find((s) => s.id === "already");
      expect(kept).toMatchObject({
        type: "rss",
        feed_url: "https://e.example/feed.xml",
        enabled: true,
      });
      expect(report.find((r) => r.id === "already")?.outcome).toBe("kept");
    }
  });

  it("replaces a known feed when a hint verifies a better one", async () => {
    const file: SourcesFile = {
      version: 1,
      sources: [
        makeSource({
          id: "tldr",
          url: "https://tldr.example/",
          feed_url: "https://tldr.example/rss",
          options: { feed_hint: "https://tldr.example/api/rss/ai" },
        }),
      ],
    };
    const { deps } = http({ "https://tldr.example/api/rss/ai": RSS });
    const result = await discoverAll(file, deps, { all: true });
    expect(result.file.sources[0]).toMatchObject({ feed_url: "https://tldr.example/api/rss/ai" });
    expect(result.file.sources[0]?.options).not.toHaveProperty("feed_hint");
  });

  it("restricts a pass to the sources asked for and keeps registry order", async () => {
    const { deps } = http(routes);
    const { file } = await discoverAll(registry(), deps, { only: ["no-feed"] });
    expect(file.sources.map((s) => s.id)).toEqual(registry().sources.map((s) => s.id));
    expect(file.sources.find((s) => s.id === "has-feed-link")?.type).toBe("firecrawl");
  });

  it("marks a newsletter roundup so dedupe can collapse its links", async () => {
    const items = Array.from(
      { length: 6 },
      (_, i) =>
        `<item><title>t${i}</title><link>https://other${i}.example/a</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate></item>`,
    ).join("");
    const { deps } = http({
      "https://digest.example/feed": `<rss version="2.0"><channel>${items}</channel></rss>`,
    });
    const file: SourcesFile = {
      version: 1,
      sources: [
        makeSource({
          id: "digest",
          type: "firecrawl",
          url: "https://digest.example/feed",
          feed_url: null,
        }),
      ],
    };
    const result = await discoverAll(file, deps);
    expect(result.file.sources[0]?.options.kind).toBe("newsletter-link");
  });
});

describe("a social media page", () => {
  it("is refused as a source when it has no feed, since Firecrawl cannot read it", async () => {
    const { deps } = http({ "https://x.com/somebody": "<html><body>Sign in</body></html>" });
    await expect(
      buildSourceFromUrl(
        { url: "https://x.com/somebody", origin: "manual", takenIds: new Set(), existing: [] },
        deps,
      ),
    ).rejects.toThrow(/Social media pages cannot be read/);
  });
});
