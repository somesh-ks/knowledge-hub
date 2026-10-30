import { describe, expect, it } from "vitest";
import { arxivQueryUrl, fetchArxiv, unversionedArxivUrl } from "../src/fetch/arxiv.js";
import { FeedParseError, looksLikeFeed, parseFeed } from "../src/fetch/feedParser.js";
import { fetchGithub } from "../src/fetch/github.js";
import { fetchProductHunt } from "../src/fetch/producthunt.js";
import { fetchRss } from "../src/fetch/rss.js";
import { fetchYoutube } from "../src/fetch/youtube.js";
import { fakeFetch, fixture, makeDeps, makeSource, NOW, WIDE } from "./fetch-helpers.js";

const FEED_URL = "https://example.com/feed.xml";
const window = (from: string) => ({ from: new Date(from), to: NOW });

describe("parseFeed", () => {
  it("reads RSS 2.0 with content:encoded and dc:creator", () => {
    const feed = parseFeed(fixture("fetch-rss2-comeau.xml"), FEED_URL);
    expect(feed.format).toBe("rss");
    expect(feed.title).toBe("Josh Comeau's blog");
    expect(feed.entries).toHaveLength(3);
    const first = feed.entries[0];
    expect(first?.title).toBe("Getting Started with Anchor Positioning");
    expect(first?.link).toBe("https://www.joshwcomeau.com/css/anchor-positioning/");
    expect(first?.author).toBe("Josh W. Comeau");
    expect(first?.published).toBe("Mon, 06 Jul 2026 13:15:00 GMT");
    expect(first?.content).toContain("<p>For decades");
  });

  it("reads Atom with alternate links, summary and published dates", () => {
    const feed = parseFeed(
      fixture("fetch-atom-willison.xml"),
      "https://simonwillison.net/atom/everything/",
    );
    expect(feed.format).toBe("atom");
    expect(feed.entries).toHaveLength(3);
    expect(feed.entries[0]?.link).toBe(
      "https://simonwillison.net/2026/Oct/4/qwen38-addition-in-words/",
    );
    expect(feed.entries[0]?.published).toBe("2026-10-04T23:34:00+00:00");
    expect(feed.entries[0]?.summary).toContain("Research:");
  });

  it("reads RDF (RSS 1.0) where items are siblings of the channel", () => {
    const feed = parseFeed(fixture("fetch-rdf-rss1.xml"), "https://example.org/");
    expect(feed.format).toBe("rdf");
    expect(feed.title).toBe("Example Typography Notes");
    expect(feed.entries).toHaveLength(3);
    expect(feed.entries[0]?.author).toBe("Ada Lovelace");
    expect(feed.entries[0]?.published).toBe("2026-10-03T08:15:00Z");
  });

  it("resolves relative links and skips non-article atom links", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title>
      <link rel="self" href="/self"/><link rel="alternate" href="/posts/1"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, "https://example.com/feed").entries[0]?.link).toBe(
      "https://example.com/posts/1",
    );
  });

  it("falls back to a permalink guid when an RSS item has no link", () => {
    const xml = `<rss version="2.0"><channel><item><title>T</title>
      <guid isPermaLink="true">https://example.com/g</guid></item>
      <item><title>U</title><guid isPermaLink="false">abc-123</guid></item></channel></rss>`;
    const entries = parseFeed(xml).entries;
    expect(entries[0]?.link).toBe("https://example.com/g");
    expect(entries[1]?.link).toBeUndefined();
  });

  it("takes names from 'address (Name)' authors and ignores bare addresses", () => {
    const xml = `<rss version="2.0"><channel>
      <item><title>A</title><author>ada@example.com (Ada Lovelace)</author></item>
      <item><title>B</title><author>noreply@example.com</author></item></channel></rss>`;
    const entries = parseFeed(xml).entries;
    expect(entries[0]?.author).toBe("Ada Lovelace");
    expect(entries[1]?.author).toBeUndefined();
  });

  it("flattens xhtml content", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Hi &amp;amp; bye</title>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>First</p><p>Second</p></div></content></entry></feed>`;
    expect(parseFeed(xml).entries[0]?.content).toBe("First Second");
  });

  it("rejects HTML and malformed documents", () => {
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow(FeedParseError);
    expect(() => parseFeed("")).toThrow(FeedParseError);
  });

  it("is not fooled by HTML quoted inside the first entry of a feed", () => {
    const quoted = `<?xml version="1.0"?>\n<rss version="2.0"><channel><item><title>t</title><description><![CDATA[<html><body>quoted</body></html>]]></description></item></channel></rss>`;
    expect(looksLikeFeed(quoted)).toBe(true);
  });

  it("skips a byte order mark, comments and a doctype before the root element", () => {
    expect(
      looksLikeFeed(
        `${String.fromCharCode(0xfeff)}<?xml version="1.0"?><!-- generated --><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
      ),
    ).toBe(true);
    expect(looksLikeFeed("<!DOCTYPE html><html><body><rss>not a feed</rss></body></html>")).toBe(
      false,
    );
    expect(looksLikeFeed("")).toBe(false);
  });

  it("recognizes feeds by their opening markup", () => {
    expect(looksLikeFeed(fixture("fetch-rss2-comeau.xml"))).toBe(true);
    expect(looksLikeFeed(fixture("fetch-github-releases.atom"))).toBe(true);
    expect(looksLikeFeed(fixture("sources-page-no-feed.html"))).toBe(false);
  });
});

describe("fetchRss", () => {
  const source = makeSource({ id: "comeau", name: "Josh W. Comeau", feed_url: FEED_URL });

  it("turns RSS entries into items inside the window, with cleaned text", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("fetch-rss2-comeau.xml") }));
    const items = await fetchRss(source, window("2026-04-01T00:00:00Z"), deps);
    expect(items.map((i) => i.title)).toEqual([
      "Getting Started with Anchor Positioning",
      "CSS vs. JavaScript",
      "Scroll-Driven Animations",
    ]);
    const first = items[0];
    expect(first?.canonical_url).toBe("https://www.joshwcomeau.com/css/anchor-positioning");
    expect(first?.author).toBe("Josh W. Comeau");
    expect(first?.published_at).toBe("2026-07-06T13:15:00.000Z");
    expect(first?.snippet.startsWith("For decades, one of the most notoriously")).toBe(true);
    expect(first?.snippet.length).toBeLessThanOrEqual(240);
    expect(first?.snippet).not.toMatch(/[<>]/);
    expect(first?.source_type).toBe("rss");
  });

  it("drops entries older than the window", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("fetch-rss2-comeau.xml") }));
    expect(await fetchRss(source, window("2026-07-01T00:00:00Z"), deps)).toHaveLength(1);
    expect(await fetchRss(source, window("2026-08-01T00:00:00Z"), deps)).toHaveLength(0);
  });

  it("handles Atom feeds and strips HTML from the summary", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("fetch-atom-willison.xml") }));
    const items = await fetchRss(source, window("2026-10-03T00:00:00Z"), deps);
    expect(items).toHaveLength(3);
    expect(items[0]?.canonical_url).toBe(
      "https://simonwillison.net/2026/Oct/4/qwen38-addition-in-words",
    );
    expect(items[0]?.snippet.startsWith("Research: Qwen3.8 27B addition in words")).toBe(true);
    expect(items[0]?.snippet).not.toContain("<");
  });

  it("handles RDF, keeps dated items only, and keeps full text from content:encoded", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("fetch-rdf-rss1.xml") }));
    const items = await fetchRss(source, window("2026-10-01T00:00:00Z"), deps);
    expect(items.map((i) => i.title)).toEqual([
      "Optical sizes in variable fonts",
      "Hanging punctuation without hacks",
    ]);
    expect(items[0]?.canonical_url).toBe("https://example.org/notes/optical-sizes");
    expect(items[0]?.content).toContain("automatic optical sizing");
    expect(items[1]?.published_at).toBe("2026-10-01T15:00:00.000Z");
  });

  it("copes with a newsletter issue whose body is a table-heavy HTML email", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("fetch-rss2-newsletter-issue.xml") }));
    const items = await fetchRss(source, window("2026-09-01T00:00:00Z"), deps);
    expect(items).toHaveLength(2);
    expect(items[0]?.canonical_url).toBe("https://javascriptweekly.com/issues/804");
    expect(items[0]?.snippet.length).toBeLessThanOrEqual(240);
    expect(items[0]?.snippet).not.toContain("<");
    expect(items[0]?.content?.length ?? 0).toBeLessThanOrEqual(20_000);
  });

  it("fails clearly when the source has no feed_url or serves HTML", async () => {
    const deps = makeDeps(fakeFetch({ [FEED_URL]: fixture("sources-page-no-feed.html") }));
    await expect(fetchRss({ ...source, feed_url: null }, WIDE, deps)).rejects.toThrow(
      /no feed_url/,
    );
    await expect(fetchRss(source, WIDE, deps)).rejects.toThrow(FeedParseError);
  });
});

describe("fetchGithub", () => {
  const source = makeSource({
    id: "shadcn-ui",
    name: "shadcn/ui",
    type: "github",
    feed_url: "https://github.com/shadcn-ui/ui/releases.atom",
    options: { repo: "shadcn-ui/ui" },
  });
  const feed = fixture("fetch-github-releases.atom");

  it("prefixes bare release tags with the project name and cleans the notes", async () => {
    const deps = makeDeps(fakeFetch({ [source.feed_url as string]: feed }));
    const items = await fetchGithub(source, WIDE, deps);
    expect(items.map((i) => i.title)).toEqual([
      "shadcn/ui: shadcn@4.21.2",
      "shadcn/ui: @shadcn/registry@0.1.1",
      "shadcn/ui: shadcn@4.21.1",
    ]);
    expect(items[0]?.canonical_url).toBe(
      "https://github.com/shadcn-ui/ui/releases/tag/shadcn%404.21.2",
    );
    expect(items[0]?.published_at).toBe("2026-10-05T14:38:22.000Z");
    expect(items[0]?.snippet.startsWith("Patch Changes")).toBe(true);
    expect(items[0]?.source_type).toBe("github");
  });

  it("does not repeat the project name when the tag already has it", async () => {
    const named = makeSource({ ...source, name: "shadcn" });
    const deps = makeDeps(fakeFetch({ [source.feed_url as string]: feed }));
    const items = await fetchGithub(named, WIDE, deps);
    expect(items[0]?.title).toBe("shadcn@4.21.2");
  });

  it("builds the feed address from options.repo when feed_url is empty", async () => {
    const fake = fakeFetch({ "https://github.com/shadcn-ui/ui/releases.atom": feed });
    await fetchGithub(
      { ...source, feed_url: null },
      window("2026-10-02T00:00:00Z"),
      makeDeps(fake),
    );
    expect(fake.calls).toEqual(["https://github.com/shadcn-ui/ui/releases.atom"]);
    await expect(
      fetchGithub({ ...source, feed_url: null, options: {} }, WIDE, makeDeps(fake)),
    ).rejects.toThrow(/options.repo/);
  });
});

describe("fetchYoutube", () => {
  const source = makeSource({
    id: "fireship",
    name: "Fireship",
    type: "youtube",
    feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA",
    options: { channel_id: "UCsBjURrPoezykLs9EqgamOA" },
  });

  it("reads videos with description snippets and honors the window", async () => {
    const deps = makeDeps(fakeFetch({ [source.feed_url as string]: fixture("fetch-youtube.xml") }));
    const items = await fetchYoutube(source, window("2026-10-01T00:00:00Z"), deps);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("PewDiePie is setting AI free... and OpenAI is furious");
    expect(items[0]?.canonical_url).toBe("https://www.youtube.com/watch?v=_5p1_TNSWqQ");
    expect(items[0]?.author).toBe("Fireship");
    expect(items[0]?.snippet).toContain("Namespace is actually the fastest way");
    expect(items[0]?.source_type).toBe("youtube");
    // The community score reads this; the feed's media:community block is the only place it lives.
    expect(items[0]?.signals.youtube_views).toBe(93644);
    // The score trusts a favorite channel's videos; only the owner's Favorite switch sets it.
    expect(items[0]?.signals.creator_vetted).toBeUndefined();
    const favorite = await fetchYoutube(
      { ...source, high_signal: true },
      window("2026-10-01T00:00:00Z"),
      deps,
    );
    expect(favorite.every((item) => item.signals.creator_vetted === true)).toBe(true);
  });

  it("builds the feed address from the channel id and skips Shorts", async () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Short</title>
      <link rel="alternate" href="https://www.youtube.com/shorts/abc"/><published>2026-10-05T00:00:00+00:00</published></entry>
      <entry><title>Long</title><link rel="alternate" href="https://www.youtube.com/watch?v=xyz"/>
      <published>2026-10-05T00:00:00+00:00</published></entry></feed>`;
    const fake = fakeFetch({
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA": xml,
    });
    const items = await fetchYoutube({ ...source, feed_url: null }, WIDE, makeDeps(fake));
    expect(items.map((i) => i.title)).toEqual(["Long"]);
  });

  it("scores a video's views against its own channel's median, not against other channels", async () => {
    const entry = (n: number, views: number) =>
      `<entry><title>V${n}</title><link rel="alternate" href="https://www.youtube.com/watch?v=vid${String(n).padStart(8, "0")}"/>
      <published>2026-10-05T00:00:00+00:00</published>
      <media:group><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`;
    const feed = (counts: number[]) =>
      `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">${counts
        .map((views, n) => entry(n, views))
        .join("")}</feed>`;
    const url = "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA";
    const read = (counts: number[]) =>
      fetchYoutube(
        { ...source, feed_url: null },
        WIDE,
        makeDeps(fakeFetch({ [url]: feed(counts) })),
      );
    // The same 10 times its channel's median is worth the same votes on a small and a large channel.
    const small = await read([100, 100, 100, 100, 1000]);
    const large = await read([1e6, 1e6, 1e6, 1e6, 1e7]);
    expect(small[4]?.signals.youtube_votes).toBe(large[4]?.signals.youtube_votes);
    expect(small[4]?.signals.youtube_votes).toBeGreaterThan(1400);
    expect(small[0]?.signals.youtube_votes).toBe(0);
    // Too few videos to know what is typical: views are kept, no votes are invented.
    const few = await read([100, 5000]);
    expect(few[1]?.signals.youtube_votes).toBeUndefined();
  });

  it("reads the uploads playlist feed when YouTube answers the channel feed with 404", async () => {
    const fake = fakeFetch({
      [source.feed_url as string]: { status: 404 },
      "https://www.youtube.com/feeds/videos.xml?playlist_id=UULFsBjURrPoezykLs9EqgamOA":
        fixture("fetch-youtube.xml"),
    });
    const items = await fetchYoutube(source, window("2026-10-01T00:00:00Z"), makeDeps(fake));
    expect(items).toHaveLength(2);
  });

  it("keeps the channel feed's error when the playlist feed fails too", async () => {
    const fake = fakeFetch({ "https://www.youtube.com/feeds/": { status: 404 } });
    await expect(fetchYoutube(source, WIDE, makeDeps(fake))).rejects.toMatchObject({ status: 404 });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("fetchProductHunt", () => {
  it("uses the tagline as the snippet and drops the discussion footer", async () => {
    const source = makeSource({
      id: "product-hunt",
      type: "producthunt",
      feed_url: "https://www.producthunt.com/feed",
    });
    const deps = makeDeps(
      fakeFetch({ [source.feed_url as string]: fixture("fetch-producthunt.xml") }),
    );
    const items = await fetchProductHunt(source, window("2026-10-04T00:00:00Z"), deps);
    expect(items.map((i) => i.title)).toEqual(["crosswalk", "Jarq", "Reviu"]);
    expect(items[0]?.snippet).toBe("A third place for people & their agents, starting with inbox");
    expect(items[0]?.author).toBe("Jason Alafgani");
    expect(items[0]?.canonical_url).toBe("https://www.producthunt.com/products/crosswalk");
    expect(items[0]?.published_at).toBe("2026-10-05T03:48:12.000Z");
  });
});

describe("fetchArxiv", () => {
  const source = makeSource({ id: "arxiv-cs-hc", type: "arxiv", options: { category: "cs.HC" } });

  it("queries by submission date and strips the version from the abstract link", async () => {
    const fake = fakeFetch({ "https://export.arxiv.org/api/query": fixture("fetch-arxiv.xml") });
    const items = await fetchArxiv(source, window("2026-10-01T00:00:00Z"), makeDeps(fake));
    expect(fake.calls[0]).toContain("sortBy=submittedDate");
    expect(fake.calls[0]).toContain("sortOrder=descending");
    expect(fake.calls[0]).toContain("search_query=cat%3Acs.HC");
    expect(items).toHaveLength(3);
    expect(items[0]?.canonical_url).toBe("https://arxiv.org/abs/2610.03511");
    expect(items[0]?.published_at).toBe("2026-10-02T16:05:23.000Z");
    expect(items[0]?.title).not.toMatch(/\s{2,}|\n/);
    expect(items[0]?.snippet.length).toBeGreaterThan(50);
  });

  it("builds the query URL and normalizes links", () => {
    expect(arxivQueryUrl("cs.HC", 50)).toBe(
      "https://export.arxiv.org/api/query?search_query=cat%3Acs.HC&sortBy=submittedDate&sortOrder=descending&max_results=50",
    );
    expect(unversionedArxivUrl("http://arxiv.org/abs/2610.03511v3")).toBe(
      "https://arxiv.org/abs/2610.03511",
    );
    expect(unversionedArxivUrl("https://arxiv.org/abs/2610.03511")).toBe(
      "https://arxiv.org/abs/2610.03511",
    );
    expect(unversionedArxivUrl(undefined)).toBeUndefined();
  });
});
