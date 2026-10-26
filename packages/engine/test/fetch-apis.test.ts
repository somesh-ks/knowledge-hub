import { describe, expect, it } from "vitest";
import { fetchCrossref } from "../src/fetch/crossref.js";
import { exaSearchBody, fetchExa, parseExaResults } from "../src/fetch/exa.js";
import { fetchFirecrawl } from "../src/fetch/firecrawl.js";
import { extractEntries, findDate } from "../src/fetch/firecrawlExtract.js";
import { fetchHn, hnQueryUrl } from "../src/fetch/hn.js";
import { fetchLobsters } from "../src/fetch/lobsters.js";
import type { ExaQuery } from "../src/fetch/queries.js";
import { SourceSkipped } from "../src/fetch/types.js";
import { fakeFetch, fixture, makeDeps, makeSource, NOW, WIDE } from "./fetch-helpers.js";

const window = (from: string) => ({ from: new Date(from), to: NOW });

describe("fetchHn", () => {
  const source = makeSource({
    id: "hn-show",
    type: "hn",
    feed_url: "https://hn.algolia.com/api/v1/search_by_date",
    options: { tags: "show_hn", min_points: "30" },
  });

  it("asks Algolia for Show HN above the points floor since the window start", async () => {
    const fake = fakeFetch({
      "https://hn.algolia.com/api/v1/search_by_date": fixture("fetch-hn.json"),
    });
    const from = window("2026-10-01T00:00:00Z");
    await fetchHn(source, from, makeDeps(fake));
    const url = new URL(fake.calls[0] ?? "");
    expect(url.searchParams.get("tags")).toBe("show_hn");
    expect(url.searchParams.get("numericFilters")).toBe(
      `points>30,created_at_i>${Date.parse("2026-10-01T00:00:00Z") / 1000}`,
    );
    expect(url.searchParams.get("hitsPerPage")).toBe("100");
  });

  it("maps hits to items with votes as signals", async () => {
    const deps = makeDeps(
      fakeFetch({ "https://hn.algolia.com/api/v1/search_by_date": fixture("fetch-hn.json") }),
    );
    const items = await fetchHn(source, window("2026-10-01T00:00:00Z"), deps);
    expect(items).toHaveLength(4);
    const popular = items.find((i) => i.title.includes("AI search for every photo"));
    expect(popular?.signals).toEqual({ hn_points: 162, hn_comments: 73 });
    expect(popular?.canonical_url).toBe("https://github.com/allenv0/SCM");
    expect(popular?.author).toBeTruthy();
    expect(popular?.published_at).toBe("2026-10-04T09:24:52.000Z");
    expect(popular?.source_type).toBe("hn");
  });

  it("uses the discussion page for text-only posts and skips malformed hits", async () => {
    const payload = JSON.stringify({
      hits: [
        {
          objectID: "123",
          title: "Show HN: A text-only launch",
          url: null,
          author: "pg",
          points: 99,
          num_comments: 4,
          created_at_i: Date.parse("2026-10-05T00:00:00Z") / 1000,
          story_text: "<p>Hello <i>HN</i></p>",
        },
        { objectID: "456" },
        "garbage",
      ],
    });
    const deps = makeDeps(fakeFetch({ "https://hn.algolia.com/api/v1/search_by_date": payload }));
    const items = await fetchHn(source, WIDE, deps);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://news.ycombinator.com/item?id=123");
    expect(items[0]?.snippet).toBe("Hello HN");
  });

  it("fails on an unexpected response shape", async () => {
    const deps = makeDeps(fakeFetch({ "https://hn.algolia.com/": '{"message":"rate limited"}' }));
    await expect(fetchHn(source, WIDE, deps)).rejects.toThrow(/unexpected Hacker News response/);
  });

  it("builds the query URL", () => {
    expect(hnQueryUrl("https://x.test/s", "story", 100, 5)).toBe(
      "https://x.test/s?tags=story&numericFilters=points%3E100%2Ccreated_at_i%3E5&hitsPerPage=100",
    );
  });
});

describe("fetchLobsters", () => {
  const source = makeSource({
    id: "lobsters",
    type: "lobsters",
    feed_url: "https://lobste.rs/hottest.json",
  });

  it("maps stories with score as a signal and filters by window", async () => {
    const deps = makeDeps(
      fakeFetch({ [source.feed_url as string]: fixture("fetch-lobsters.json") }),
    );
    const items = await fetchLobsters(source, window("2026-10-05T00:00:00Z"), deps);
    expect(items).toHaveLength(4);
    expect(items[0]?.signals).toEqual({ lobsters_score: 63 });
    expect(items[0]?.author).toBe("novedevo");
    expect(items[0]?.canonical_url).toBe(
      "https://gleam.run/news/gleam-doesnt-compile-to-erlang-source-anymore",
    );
    expect(await fetchLobsters(source, window("2026-10-06T00:00:00Z"), deps)).toHaveLength(0);
  });

  it("falls back to the Lobsters page for text posts and reads object submitters", async () => {
    const payload = JSON.stringify([
      {
        short_id_url: "https://lobste.rs/s/abc123",
        created_at: "2026-10-05T10:00:00.000-05:00",
        title: "Ask: how do you test feeds?",
        url: "",
        score: 12,
        comment_count: 3,
        description_plain: "Curious.",
        submitter_user: { username: "alice" },
      },
    ]);
    const deps = makeDeps(fakeFetch({ [source.feed_url as string]: payload }));
    const items = await fetchLobsters(source, WIDE, deps);
    expect(items[0]?.url).toBe("https://lobste.rs/s/abc123");
    expect(items[0]?.author).toBe("alice");
  });
});

describe("fetchCrossref", () => {
  const source = makeSource({
    id: "acm-pacmhci",
    type: "crossref",
    feed_url: "https://api.crossref.org/journals/2573-0142/works",
    options: { issn: "2573-0142" },
  });

  it("selects fields, sorts by deposit date and uses DOI links", async () => {
    const fake = fakeFetch({
      "https://api.crossref.org/journals/2573-0142/works": fixture("fetch-crossref.json"),
    });
    const items = await fetchCrossref(source, window("2026-09-20T00:00:00Z"), makeDeps(fake));
    const url = new URL(fake.calls[0] ?? "");
    expect(url.searchParams.get("filter")).toBe("from-created-date:2026-09-20");
    expect(url.searchParams.get("select")).toContain("abstract");
    expect(url.searchParams.get("sort")).toBe("created");
    expect(url.searchParams.has("mailto")).toBe(false);
    expect(items).toHaveLength(4);
    expect(items[0]?.canonical_url).toBe("https://doi.org/10.1145/3817021");
    expect(items[0]?.published_at).toBe("2026-09-23T19:48:56.000Z");
    expect(items[0]?.snippet).not.toContain("jats:");
  });

  it("keeps works whose abstract is missing", async () => {
    const deps = makeDeps(
      fakeFetch({ "https://api.crossref.org/": fixture("fetch-crossref.json") }),
    );
    const items = await fetchCrossref(source, window("2026-09-20T00:00:00Z"), deps);
    const missing = items.find((i) => i.canonical_url.endsWith("3817030"));
    expect(missing?.snippet).toBe("");
    expect(missing?.title).toContain("Siblings of Autistic Individuals");
  });

  it("names the first three authors and adds et al. beyond that", async () => {
    const deps = makeDeps(
      fakeFetch({ "https://api.crossref.org/": fixture("fetch-crossref.json") }),
    );
    const items = await fetchCrossref(source, window("2026-09-20T00:00:00Z"), deps);
    expect(items[0]?.author?.endsWith("et al.")).toBe(true);
    expect(items[0]?.author?.split(",")).toHaveLength(3);
  });

  it("sends the polite mailto only when one is configured", async () => {
    const fake = fakeFetch({ "https://api.crossref.org/": fixture("fetch-crossref.json") });
    await fetchCrossref(source, WIDE, makeDeps(fake, { crossrefMailto: "ops@example.com" }));
    expect(new URL(fake.calls[0] ?? "").searchParams.get("mailto")).toBe("ops@example.com");
  });

  it("needs an ISSN", async () => {
    const deps = makeDeps(fakeFetch({}));
    await expect(fetchCrossref({ ...source, options: {} }, WIDE, deps)).rejects.toThrow(
      /options.issn/,
    );
  });
});

describe("fetchExa", () => {
  const source = makeSource({
    id: "exa-discovery",
    type: "exa",
    feed_url: "https://api.exa.ai/search",
  });
  const queries: ExaQuery[] = [
    { id: "drawers", query: "interruptible drawer animation" },
    { id: "tokens", query: "design tokens specification", include_domains: ["example.dev"] },
  ];

  it("skips without an API key instead of failing", async () => {
    const deps = makeDeps(fakeFetch({}), { exa: { queries } });
    await expect(fetchExa(source, WIDE, deps)).rejects.toBeInstanceOf(SourceSkipped);
  });

  it("skips when there are no queries", async () => {
    const deps = makeDeps(fakeFetch({}), { exa: { apiKey: "key-123456789", queries: [] } });
    await expect(fetchExa(source, WIDE, deps)).rejects.toBeInstanceOf(SourceSkipped);
  });

  it("posts one search per query with the key in a header and the window as a date floor", async () => {
    const bodies: Record<string, unknown>[] = [];
    let header: string | null = null;
    const fake = fakeFetch({
      "https://api.exa.ai/search": (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        header = new Headers(init?.headers).get("x-api-key");
        return new Response(fixture("fetch-exa.json"));
      },
    });
    const deps = makeDeps(fake, { exa: { apiKey: "key-123456789", queries } });
    const items = await fetchExa(source, window("2026-10-01T00:00:00Z"), deps);
    expect(header).toBe("key-123456789");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      query: "interruptible drawer animation",
      startPublishedDate: "2026-10-01T00:00:00.000Z",
      numResults: 10,
    });
    expect(bodies[0]).not.toHaveProperty("includeDomains");
    expect(bodies[1]).toMatchObject({ includeDomains: ["example.dev"] });
    expect(bodies[0]?.contents).toEqual({ highlights: { maxCharacters: 600 } });
    // One in-window result per query; the old and undated results are dropped.
    expect(items).toHaveLength(2);
    expect(items[0]?.canonical_url).toBe("https://example.dev/blog/drawer-springs");
    expect(items[0]?.snippet.startsWith("Retargeting a spring mid-flight")).toBe(true);
    expect(items[0]?.author).toBe("Sam Rivera");
    expect(items[0]?.source_type).toBe("exa");
  });

  it("honors a custom base URL", async () => {
    const fake = fakeFetch({ "https://proxy.test/search": fixture("fetch-exa.json") });
    const deps = makeDeps(fake, {
      exa: {
        apiKey: "key-123456789",
        baseUrl: "https://proxy.test/",
        queries: queries.slice(0, 1),
      },
    });
    await fetchExa(source, WIDE, deps);
    expect(fake.calls).toEqual(["https://proxy.test/search"]);
  });

  it("survives one failing query but not all of them", async () => {
    let call = 0;
    const flaky = fakeFetch({
      "https://api.exa.ai/search": () =>
        ++call === 1
          ? new Response("boom", { status: 400 })
          : new Response(fixture("fetch-exa.json")),
    });
    const deps = makeDeps(flaky, { exa: { apiKey: "key-123456789", queries } });
    expect(await fetchExa(source, window("2026-10-01T00:00:00Z"), deps)).toHaveLength(1);

    const dead = makeDeps(fakeFetch({ "https://api.exa.ai/search": { status: 400 } }), {
      exa: { apiKey: "key-123456789", queries },
    });
    await expect(fetchExa(source, WIDE, dead)).rejects.toThrow(/every Exa query failed/);
  });

  it("copies a query's category hint onto its results and adds none for an unhinted query", async () => {
    const mixed: ExaQuery[] = [
      { id: "drawers", query: "interruptible drawer animation" },
      {
        id: "launches",
        query: "consumer hardware launches",
        category_hint: "consumer_tech_releases",
      },
      { id: "tokens", query: "design tokens specification" },
    ];
    const bodies: Record<string, unknown>[] = [];
    const fake = fakeFetch({
      "https://api.exa.ai/search": (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(fixture("fetch-exa.json"));
      },
    });
    const deps = makeDeps(fake, { exa: { apiKey: "key-123456789", queries: mixed } });
    const items = await fetchExa(source, window("2026-10-01T00:00:00Z"), deps);
    // One in-window result per query, in query order.
    expect(items).toHaveLength(3);
    expect(items[0]).not.toHaveProperty("category_hint");
    expect(items[1]?.category_hint).toBe("consumer_tech_releases");
    expect(items[2]).not.toHaveProperty("category_hint");
    // The hint is ours, for triage. It is never sent to the search API.
    for (const body of bodies) expect(JSON.stringify(body)).not.toContain("category_hint");
  });

  it("keeps the results of the queries that worked, each with its own hint, when another fails", async () => {
    const mixed: ExaQuery[] = [
      { id: "broken", query: "this one fails", category_hint: "hci_empirical_research" },
      {
        id: "launches",
        query: "consumer hardware launches",
        category_hint: "consumer_tech_releases",
      },
    ];
    const fake = fakeFetch({
      "https://api.exa.ai/search": (_url, init) =>
        String(init?.body).includes("this one fails")
          ? new Response("boom", { status: 400 })
          : new Response(fixture("fetch-exa.json")),
    });
    const deps = makeDeps(fake, { exa: { apiKey: "key-123456789", queries: mixed } });
    const items = await fetchExa(source, window("2026-10-01T00:00:00Z"), deps);
    expect(items.map((item) => item.category_hint)).toEqual(["consumer_tech_releases"]);
  });

  it("builds request bodies and parses results", () => {
    const body = exaSearchBody({ id: "x", query: "q", include_domains: [] }, WIDE);
    expect(body).not.toHaveProperty("includeDomains");
    expect(
      exaSearchBody({ id: "x", query: "q", category_hint: "consumer_tech_releases" }, WIDE),
    ).not.toHaveProperty("category_hint");
    expect(parseExaResults(JSON.parse(fixture("fetch-exa.json")))).toHaveLength(3);
    expect(() => parseExaResults({ nope: true })).toThrow(/unexpected Exa response/);
  });
});

describe("firecrawl extraction", () => {
  it("finds dates in the formats pages use", () => {
    expect(findDate("Posted October 3, 2026")?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(findDate("3rd Oct 2026")?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(findDate("14 July 2026")?.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(findDate("2026-09-28")?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(findDate("February 30, 2026")).toBeUndefined();
    expect(findDate("no date here")).toBeUndefined();
  });

  it("extracts dated links from a blog index and ignores navigation", () => {
    const { dated, headings, undated } = extractEntries(
      fixture("fetch-firecrawl-blog-index.md"),
      "https://example.com/blog",
    );
    expect(dated.map((e) => e.title)).toEqual([
      "Rebuilding our command palette with anchor positioning",
      "A field guide to interruptible transitions",
      "Shipping a design token pipeline",
    ]);
    expect(dated.map((e) => (e.publishedAt as Date).toISOString().slice(0, 10))).toEqual([
      "2026-10-03",
      "2026-09-28",
      "2026-07-14",
    ]);
    expect(dated[0]?.url).toBe("https://example.com/blog/command-palette-anchor-positioning");
    expect(headings).toEqual([]);
    expect(undated).toEqual([]);
  });

  it("extracts dated headings from a single-page changelog with anchor URLs", () => {
    const { dated, headings } = extractEntries(
      fixture("fetch-firecrawl-changelog.md"),
      "https://example.com/changelog",
    );
    expect(dated).toEqual([]);
    expect(headings.map((h) => h.title)).toEqual([
      "Sidebar blocks and a new Field component",
      "Registry namespaces",
    ]);
    expect(headings[0]?.url).toBe(
      "https://example.com/changelog#sidebar-blocks-and-a-new-field-component",
    );
  });

  it("falls back to the first few links of an undated page", () => {
    const { dated, headings, undated } = extractEntries(
      fixture("fetch-firecrawl-undated.md"),
      "https://example.com/research",
    );
    expect(dated).toHaveLength(0);
    expect(headings).toHaveLength(0);
    expect(undated.map((e) => e.title)).toEqual([
      "Notes on contrast in dark interfaces",
      "What we learned from five hundred prototypes",
      "Why timing functions matter more than durations",
    ]);
  });
});

describe("fetchFirecrawl", () => {
  const source = makeSource({
    id: "eng-blog",
    type: "firecrawl",
    url: "https://example.com/blog",
    feed_url: null,
  });
  const scrape = (markdown: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      success: true,
      data: { markdown, metadata: { title: "Engineering blog", statusCode: 200, ...extra } },
    });

  it("skips without an API key", async () => {
    await expect(fetchFirecrawl(source, WIDE, makeDeps(fakeFetch({})))).rejects.toBeInstanceOf(
      SourceSkipped,
    );
  });

  it("scrapes through /v2/scrape with a bearer token and returns in-window entries", async () => {
    let auth: string | null = null;
    let body: Record<string, unknown> = {};
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": (_url, init) => {
        auth = new Headers(init?.headers).get("authorization");
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(scrape(fixture("fetch-firecrawl-blog-index.md")));
      },
    });
    const deps = makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } });
    const items = await fetchFirecrawl(source, window("2026-09-01T00:00:00Z"), deps);
    expect(auth).toBe("Bearer fc-key-123456789");
    expect(body).toMatchObject({
      url: "https://example.com/blog",
      formats: ["markdown"],
      onlyMainContent: true,
    });
    expect(items.map((i) => i.title)).toEqual([
      "Rebuilding our command palette with anchor positioning",
      "A field guide to interruptible transitions",
    ]);
    expect(items[0]?.source_type).toBe("firecrawl");
  });

  it("keeps heading entries distinct by their anchor", async () => {
    const changelog = makeSource({
      id: "changelog",
      type: "firecrawl",
      url: "https://example.com/changelog",
      feed_url: null,
    });
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": scrape(fixture("fetch-firecrawl-changelog.md")),
    });
    const items = await fetchFirecrawl(
      changelog,
      window("2026-09-10T00:00:00Z"),
      makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } }),
    );
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
    expect(items[0]?.canonical_url).toContain("#sidebar-blocks");
  });

  it("returns undated links when a page shows no dates", async () => {
    const research = makeSource({
      id: "research",
      type: "firecrawl",
      url: "https://example.com/research",
      feed_url: null,
    });
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": scrape(fixture("fetch-firecrawl-undated.md")),
    });
    const items = await fetchFirecrawl(
      research,
      WIDE,
      makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } }),
    );
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.published_at === undefined)).toBe(true);
  });

  it("returns the page itself as one item when nothing could be extracted", async () => {
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": scrape("Welcome to our studio. We make interfaces."),
    });
    const items = await fetchFirecrawl(
      source,
      WIDE,
      makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.canonical_url).toBe("https://example.com/blog");
    expect(items[0]?.title).toBe("Engineering blog");
    expect(items[0]?.snippet).toContain("Welcome to our studio");
  });

  it("returns nothing when every dated entry is older than the window", async () => {
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": scrape(fixture("fetch-firecrawl-blog-index.md")),
    });
    const items = await fetchFirecrawl(
      source,
      window("2026-10-05T00:00:00Z"),
      makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } }),
    );
    expect(items).toEqual([]);
  });

  it("fails when the scraped page itself returned an error status", async () => {
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": scrape("", { statusCode: 404 }),
    });
    await expect(
      fetchFirecrawl(source, WIDE, makeDeps(fake, { firecrawl: { apiKey: "fc-key-123456789" } })),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("fails on an unsuccessful or malformed API response", async () => {
    const failed = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": JSON.stringify({
        success: false,
        error: "Unsupported URL",
      }),
    });
    await expect(
      fetchFirecrawl(source, WIDE, makeDeps(failed, { firecrawl: { apiKey: "fc-key-123456789" } })),
    ).rejects.toThrow(/Unsupported URL/);
    const malformed = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": JSON.stringify({ hello: "world" }),
    });
    await expect(
      fetchFirecrawl(
        source,
        WIDE,
        makeDeps(malformed, { firecrawl: { apiKey: "fc-key-123456789" } }),
      ),
    ).rejects.toThrow(/unexpected Firecrawl response/);
  });
});

describe("fetchFirecrawl via Alexandria (anthropic-com)", () => {
  const source = makeSource({
    id: "anthropic-blog",
    type: "firecrawl",
    url: "https://www.anthropic.com/news",
    feed_url: null,
    options: { via: "alexandria:anthropic-com", category: "news" },
  });
  const OPEN = { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
  const keyed = { firecrawl: { apiKey: "fc-key-123456789" } };

  it("sends an alexandria body and maps typed posts to items with their real dates", async () => {
    let body: Record<string, unknown> = {};
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(fixture("fetch-alexandria-anthropic.json"));
      },
    });
    const items = await fetchFirecrawl(source, OPEN, makeDeps(fake, keyed));
    expect(body).toEqual({
      alexandria: [
        {
          provider: "anthropic-com",
          capability: "company-blog/list_posts",
          options: { category: "news" },
        },
      ],
    });
    expect(fake.calls).toHaveLength(1);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      title: "Redesigning source control at Anthropic",
      canonical_url: "https://www.anthropic.com/research/redesigning-source-control",
    });
    expect(items[0]?.published_at?.startsWith("2026-10-13")).toBe(true);
    expect(items[4]?.snippet).toContain("Topics: Claude Code, policy.");
  });

  it("falls back to the page scrape when the capability fails", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (body.alexandria) {
          return new Response(
            JSON.stringify({
              success: true,
              data: { alexandria: [{ error: { code: "upstream" } }] },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: fixture("fetch-firecrawl-blog-index.md"),
              metadata: { statusCode: 200 },
            },
          }),
        );
      },
    });
    const items = await fetchFirecrawl(
      source,
      window("2026-09-01T00:00:00Z"),
      makeDeps(fake, keyed),
    );
    expect(bodies.map((b) => (b.alexandria ? "alexandria" : "scrape"))).toEqual([
      "alexandria",
      "scrape",
    ]);
    expect(items.length).toBeGreaterThan(0);
  });

  it("does not call Alexandria for a source without the flag", async () => {
    const plain = makeSource({ ...source, options: {} });
    const bodies: Array<Record<string, unknown>> = [];
    const fake = fakeFetch({
      "https://api.firecrawl.dev/v2/scrape": (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: fixture("fetch-firecrawl-blog-index.md"),
              metadata: { statusCode: 200 },
            },
          }),
        );
      },
    });
    await fetchFirecrawl(plain, window("2026-09-01T00:00:00Z"), makeDeps(fake, keyed));
    expect(bodies.some((b) => "alexandria" in b)).toBe(false);
  });
});
