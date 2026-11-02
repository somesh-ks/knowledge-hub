import { EMPTY_LISTING_FINGERPRINTS } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { fetchFirecrawl } from "../src/fetch/firecrawl.js";
import { fingerprintLinks, ListingMemory, mergeListings } from "../src/fetch/listingCheck.js";
import { fakeFetch, fixture, makeDeps, makeSource, NOW, WIDE } from "./fetch-helpers.js";

const PAGE = "https://example.com/blog";
const SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const KEY = { apiKey: "fc-key-123456789" };
const source = makeSource({ id: "eng-blog", type: "firecrawl", url: PAGE, feed_url: null });

const html = (...paths: string[]): string =>
  `<html><body>${paths.map((p) => `<a href="${p}">post</a>`).join("")}</body></html>`;
const scraped = JSON.stringify({
  success: true,
  data: {
    markdown: fixture("fetch-firecrawl-blog-index.md"),
    metadata: { title: "Blog", statusCode: 200 },
  },
});

// A listing the free read shows unchanged cost a Firecrawl credit every run (D222): the probe skips
// the scrape. Every doubt (a refusal, a changed link, an old fingerprint, a failed scrape) must still
// scrape, or a new article is missed without a trace.
describe("a listing whose links have not moved is not scraped", () => {
  function run(page: string | { status: number }, memory: ListingMemory, scrape = scraped) {
    const fake = fakeFetch({
      [PAGE]: typeof page === "string" ? page : { status: page.status, body: "no" },
      [SCRAPE]: scrape,
    });
    const deps = makeDeps(fake, { firecrawl: KEY, listings: memory });
    const read = () => fetchFirecrawl(source, WIDE, deps);
    return { read, scrapes: () => fake.calls.filter((url) => url === SCRAPE).length };
  }
  // The fixture's scrape finds these three posts, so a page that links them is one the check can trust.
  const links = [
    "/blog/command-palette-anchor-positioning",
    "/blog/interruptible-transitions",
    "/blog/design-token-pipeline",
  ];

  it("scrapes the first time and when a link appears, and skips in between", async () => {
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const firstRun = run(html(...links), memory);
    expect((await firstRun.read()).length).toBeGreaterThan(0);
    expect(firstRun.scrapes()).toBe(1);

    // The next run starts from what the commit stored.
    const stored = mergeListings(EMPTY_LISTING_FINGERPRINTS, [memory.scraped()], NOW);
    const same = run(html(...[...links].reverse(), `${links[0]}?utm=x`), new ListingMemory(stored));
    expect(await same.read()).toEqual([]);
    expect(same.scrapes()).toBe(0);

    const moved = run(html(...links, "/blog/d"), new ListingMemory(stored));
    expect((await moved.read()).length).toBeGreaterThan(0);
    expect(moved.scrapes()).toBe(1);
  });

  it("scrapes when the direct read is refused, when the scrape fails, and when the fingerprint is a week old", async () => {
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const refused = run({ status: 403 }, memory);
    await refused.read();
    expect(refused.scrapes()).toBe(1);
    expect(memory.scraped().sources).toEqual({});

    const failing = run(html(...links), memory, JSON.stringify({ success: false, error: "x" }));
    await expect(failing.read()).rejects.toThrow();
    expect(memory.scraped().sources).toEqual({});

    const hash = fingerprintLinks(html(...links), PAGE) as string;
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    const stale = new ListingMemory({
      version: 1,
      sources: { [source.id]: { hash, scraped_at: old } },
    });
    const week = run(html(...links), stale);
    await week.read();
    expect(week.scrapes()).toBe(1);
  });

  it("does not remember a page whose links hold none of the scrape's articles", async () => {
    // Three navigation links pass the minimum, but the posts are drawn in the browser: a fingerprint
    // of the navigation would never move and every new post would be missed.
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const navOnly = run(html("/", "/pricing", "/about"), memory);
    await navOnly.read();
    expect(memory.scraped().sources).toEqual({});
    const again = run(html("/", "/pricing", "/about"), memory);
    await again.read();
    expect(again.scrapes()).toBe(1);
  });

  it("keeps this run's scrape from skipping the run's next pass, and from counting before the commit", async () => {
    // The weekly and daily passes of one run read the same pages; the first must not make the second skip.
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    await run(html(...links), memory).read();
    expect(Object.keys(memory.scraped().sources)).toEqual([source.id]);
    const second = run(html(...links), memory);
    expect((await second.read()).length).toBeGreaterThan(0);
    expect(second.scrapes()).toBe(1);
  });

  it("asks for a page fresh when it means to remember it, and never counts a link to the page itself", async () => {
    let maxAge: unknown;
    const fake = fakeFetch({
      [PAGE]: html("/", "/pricing", PAGE),
      [SCRAPE]: (_url, init) => {
        maxAge = (JSON.parse(String(init?.body)) as { maxAge: unknown }).maxAge;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: fixture("fetch-firecrawl-changelog.md"),
              metadata: { statusCode: 200 },
            },
          }),
        );
      },
    });
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const changelog = makeSource({ id: "changelog", type: "firecrawl", url: PAGE, feed_url: null });
    await fetchFirecrawl(changelog, WIDE, makeDeps(fake, { firecrawl: KEY, listings: memory }));
    expect(maxAge).toBe(0);
    // Heading entries resolve to the page itself, which the page links: that proves no article.
    expect(memory.scraped().sources).toEqual({});
  });

  it("does not remember a page that holds an entry dated after the window", async () => {
    // The window ends before the posts' dates, so they are dropped now and a later run must take them.
    const early = { from: WIDE.from, to: new Date("2026-07-20T00:00:00Z") };
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const fake = fakeFetch({ [PAGE]: html(...links), [SCRAPE]: scraped });
    await fetchFirecrawl(source, early, makeDeps(fake, { firecrawl: KEY, listings: memory }));
    expect(memory.scraped().sources).toEqual({});
  });

  it("stores what a run scraped over the old, and lets a month-old fingerprint go", () => {
    const at = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    const entry = (hash: string, days: number) => ({ hash, scraped_at: at(days) });
    const merged = mergeListings(
      { version: 1, sources: { a: entry("a".repeat(16), 3), gone: entry("b".repeat(16), 31) } },
      [{ version: 1, sources: { a: entry("c".repeat(16), 0), b: entry("d".repeat(16), 0) } }],
      NOW,
    );
    expect(Object.keys(merged.sources).sort()).toEqual(["a", "b"]);
    expect(merged.sources.a?.hash).toBe("c".repeat(16));
  });

  it("follows href, never a data-href that comes first, and gives none to a page drawn in the browser", () => {
    const tricky = (target: string): string =>
      `<a data-href="/old" href="${target}">a</a><a href="/b">b</a><a href="/c">c</a>`;
    expect(fingerprintLinks(tricky("/new"), PAGE)).not.toBe(
      fingerprintLinks(tricky("/other"), PAGE),
    );
    expect(fingerprintLinks(html("/a", "/b"), PAGE)).toBeNull();
  });
});
