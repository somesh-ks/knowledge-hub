import { EMPTY_LISTING_FINGERPRINTS } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { fetchFirecrawl } from "../src/fetch/firecrawl.js";
import { fingerprintLinks, ListingMemory } from "../src/fetch/listingCheck.js";
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
  const links = ["/blog/a", "/blog/b", "/blog/c"];

  it("scrapes the first time and when a link appears, and skips in between", async () => {
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const first = run(html(...links), memory);
    expect((await first.read()).length).toBeGreaterThan(0);
    expect(first.scrapes()).toBe(1);

    const same = run(html(...[...links].reverse(), "/blog/a?utm=x"), memory);
    expect(await same.read()).toEqual([]);
    expect(same.scrapes()).toBe(0);

    const moved = run(html(...links, "/blog/d"), memory);
    expect((await moved.read()).length).toBeGreaterThan(0);
    expect(moved.scrapes()).toBe(1);
  });

  it("scrapes when the direct read is refused, when the scrape fails, and when the fingerprint is a week old", async () => {
    const memory = new ListingMemory(EMPTY_LISTING_FINGERPRINTS);
    const refused = run({ status: 403 }, memory);
    await refused.read();
    expect(refused.scrapes()).toBe(1);
    expect(memory.toFile([source]).sources).toEqual({});

    const failing = run(html(...links), memory, JSON.stringify({ success: false, error: "x" }));
    await expect(failing.read()).rejects.toThrow();
    expect(memory.toFile([source]).sources).toEqual({});

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

  it("gives no fingerprint to a page built in the browser", () => {
    expect(fingerprintLinks(html("/a", "/b"), PAGE)).toBeNull();
  });
});
