import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QueriesFile } from "../src/fetch/queries.js";
import { buildRegistry, stripYears, urlKey } from "../src/sources/import.js";
import { parseSourcesMd } from "../src/sources/parseSourcesMd.js";
import { parseSources } from "../src/sources/registry.js";
import { makeSource } from "./fetch-helpers.js";

const markdown = readFileSync(new URL("../../../config/sources.md", import.meta.url), "utf8");

describe("parseSourcesMd", () => {
  const sample = [
    "## 1. Blogs",
    "### Lab blogs",
    "| Source | URL | Cadence | Signal |",
    "|--------|-----|---------|--------|",
    "| Alpha Blog | https://alpha.example/blog | Monthly | notes |",
    "| **Beta** (by Bea) | [site](https://beta.example/) | Daily | x |",
    "| No url here | nothing | Weekly | y |",
    "## 7. Exa Search Queries (Automated)",
    "```text",
    '"first query 2026"',
    '"second query"',
    "```",
    "## 8. Firecrawl Watch URLs",
    "```text",
    "https://watch.example/blog",
    "```",
  ].join("\n");

  it("reads rows with names, URLs and cadence, skipping rows without a URL", () => {
    const { rows } = parseSourcesMd(sample);
    expect(rows.map((r) => [r.name, r.url, r.cadence])).toEqual([
      ["Alpha Blog", "https://alpha.example/blog", "Monthly"],
      ["Beta (by Bea)", "https://beta.example/", "Daily"],
    ]);
    expect(rows[0]?.heading).toBe("Lab blogs");
    expect(rows[0]?.section).toBe("1. Blogs");
  });

  it("reads the query and watch-URL code blocks", () => {
    const parsed = parseSourcesMd(sample);
    expect(parsed.exaQueries).toEqual(["first query 2026", "second query"]);
    expect(parsed.watchUrls).toEqual(["https://watch.example/blog"]);
  });

  it("reads the real registry file: twelve queries, twenty-one watch URLs, dozens of rows", () => {
    const parsed = parseSourcesMd(markdown);
    expect(parsed.exaQueries).toHaveLength(12);
    expect(parsed.exaQueries.slice(-2)).toEqual([
      "consumer hardware and platform launches",
      "consumer device regulation or ruling",
    ]);
    expect(parsed.watchUrls).toHaveLength(21);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(87);
  });

  it("reads the consumer tech outlets from their own table", () => {
    const rows = parseSourcesMd(markdown).rows.filter(
      (row) => row.heading === "Consumer Tech Releases (Tech releases section)",
    );
    expect(rows.map((row) => [row.name, row.url])).toEqual([
      ["9to5Google", "https://9to5google.com"],
      ["9to5Mac", "https://9to5mac.com"],
      ["Android Authority", "https://www.androidauthority.com"],
      ["GSMArena", "https://www.gsmarena.com"],
      ["Engadget", "https://www.engadget.com"],
      ["Electrek", "https://electrek.co"],
      ["Tom's Hardware", "https://www.tomshardware.com"],
    ]);
  });
});

describe("helpers", () => {
  it("strips years from queries", () => {
    expect(stripYears("new UI component library release 2026")).toBe(
      "new UI component library release",
    );
    expect(stripYears("2027 trends in CSS")).toBe("trends in CSS");
    expect(stripYears("version 12 of three.js")).toBe("version 12 of three.js");
  });

  it("keys pages by host and path, ignoring www, case and trailing slashes", () => {
    expect(urlKey("https://WWW.Example.com/Blog/")).toBe("example.com/blog");
    expect(urlKey("https://example.com/blog?x=1")).toBe("example.com/blog");
  });
});

describe("buildRegistry from config/sources.md", () => {
  const { file, queries, warnings } = buildRegistry(markdown);
  const byId = new Map(file.sources.map((s) => [s.id, s]));

  it("produces a registry that passes validation, with unique kebab-case ids", () => {
    expect(() => parseSources(file)).not.toThrow();
    expect(file.sources).toHaveLength(120);
    expect(new Set(file.sources.map((s) => s.id)).size).toBe(file.sources.length);
    expect(warnings).toEqual([]);
  });

  it("includes the listed blogs, newsletters, labs, library repos, aggregators and journals", () => {
    for (const id of [
      "rauno-freiberg",
      "emil-kowalski",
      "josh-w-comeau",
      "jhey-tompkins",
      "simon-willison",
      "import-ai",
      "openai-blog",
      "anthropic-blog",
      "deepmind-blog",
      "cloudflare-blog",
      "linear-blog",
      "friday-checkout",
      "javascript-weekly",
      "console-dev",
      "shadcn-changelog",
      "headless-ui",
      "figma-release-notes",
      "tailwind-css-blog",
      "brutalist-report",
      "the-verge",
      "nextjs-blog",
    ]) {
      expect(byId.has(id), id).toBe(true);
    }
  });

  it("seeds the nine GitHub release feeds named in the plan", () => {
    const repos = file.sources
      .filter((s) => (s.type === "github" && s.high_signal) || s.id === "astro")
      .map((s) => s.options.repo)
      .sort();
    expect(repos).toEqual([
      "assistant-ui/assistant-ui",
      "darkroomengineering/lenis",
      "emilkowalski/sonner",
      "emilkowalski/vaul",
      "motiondivision/motion",
      "mui/base-ui",
      "radix-ui/primitives",
      "shadcn-ui/ui",
      "withastro/astro",
    ]);
    expect(byId.get("radix-ui")?.feed_url).toBe(
      "https://github.com/radix-ui/primitives/releases.atom",
    );
  });

  it("seeds the API sources with verified settings", () => {
    expect(byId.get("hn-show")).toMatchObject({
      type: "hn",
      options: { tags: "show_hn", min_points: "30" },
    });
    expect(byId.get("arxiv-cs-hc")).toMatchObject({
      type: "arxiv",
      options: { category: "cs.HC" },
    });
    expect(byId.get("arxiv-cs-hc")?.feed_url).toContain("sortBy=submittedDate");
    expect(byId.get("acm-tochi")).toMatchObject({
      type: "crossref",
      tier: "weekly",
      options: { issn: "1073-0516" },
    });
    expect(byId.get("acm-pacmhci")).toMatchObject({
      type: "crossref",
      tier: "weekly",
      options: { issn: "2573-0142" },
    });
    expect(byId.get("product-hunt")?.feed_url).toBe("https://www.producthunt.com/feed");
    expect(byId.get("lobsters")?.feed_url).toBe("https://lobste.rs/hottest.json");
    expect(byId.get("exa-discovery")).toMatchObject({ type: "exa" });
  });

  it("marks the individual craft blogs, Simon Willison and shadcn as high signal", () => {
    for (const id of [
      "rauno-freiberg",
      "emil-kowalski",
      "josh-w-comeau",
      "jhey-tompkins",
      "simon-willison",
      "shadcn-changelog",
      "shadcn-ui",
    ]) {
      expect(byId.get(id)?.high_signal, id).toBe(true);
    }
    expect(byId.get("the-verge")?.high_signal).toBe(false);
  });

  it("assigns weekly tier to monthly newsletters and journals only", () => {
    const weekly = file.sources
      .filter((s) => s.tier === "weekly")
      .map((s) => s.id)
      .sort();
    expect(weekly).toEqual(["acm-pacmhci", "acm-tochi", "ahead-of-ai", "stripe-engineering"]);
  });

  it("assigns category hints where they are obvious", () => {
    expect(byId.get("arxiv-cs-hc")?.category_hint).toBe("hci_empirical_research");
    expect(byId.get("openai-blog")?.category_hint).toBe("frontier_model_releases");
    expect(byId.get("radix-ui")?.category_hint).toBe("ui_component_primitives");
    expect(byId.get("techcrunch")?.category_hint).toBe("venture_capital_and_gossip");
  });

  it("adds the seven consumer tech outlets as feeds, hinted, six candidates each", () => {
    const outlets = {
      "9to5google": ["9to5Google", "https://9to5google.com/feed/"],
      "9to5mac": ["9to5Mac", "https://9to5mac.com/feed/"],
      "android-authority": ["Android Authority", "https://www.androidauthority.com/feed/"],
      gsmarena: ["GSMArena", "https://www.gsmarena.com/rss-news-reviews.php3"],
      engadget: ["Engadget", "https://www.engadget.com/rss.xml"],
      electrek: ["Electrek", "https://electrek.co/feed/"],
      "toms-hardware": ["Tom's Hardware", "https://www.tomshardware.com/feeds.xml"],
    } as const;
    for (const [id, [name, feed]] of Object.entries(outlets)) {
      expect(byId.get(id), id).toMatchObject({
        name,
        type: "rss",
        feed_url: feed,
        tier: "daily",
        high_signal: false,
        category_hint: "consumer_tech_releases",
        enabled: true,
        options: { pool_cap: "6" },
      });
    }
    // The apostrophe in the name does not leak into the id.
    expect(byId.has("tom-s-hardware")).toBe(false);
  });

  it("hints The Verge, Ars Technica and Friday Checkout for the tech beat without a cap of their own", () => {
    for (const id of ["the-verge", "ars-technica", "friday-checkout"]) {
      expect(byId.get(id)?.category_hint, id).toBe("consumer_tech_releases");
      expect(byId.get(id)?.options, id).not.toHaveProperty("pool_cap");
    }
    const hinted = file.sources.filter((s) => s.category_hint === "consumer_tech_releases");
    expect(hinted.map((s) => s.id).sort()).toEqual([
      "9to5google",
      "9to5mac",
      "android-authority",
      "ars-technica",
      "electrek",
      "engadget",
      "friday-checkout",
      "gsmarena",
      "the-verge",
      "toms-hardware",
    ]);
  });

  it("starts page sources as scrape sources and keeps account-only feeds disabled with a note", () => {
    expect(byId.get("rauno-freiberg")).toMatchObject({
      type: "firecrawl",
      feed_url: null,
      enabled: true,
    });
    expect(byId.get("daily-dev")).toMatchObject({ enabled: false });
    expect(byId.get("daily-dev")?.options.note).toMatch(/account/);
  });

  it("records curated decisions: dead and duplicate sources off with a reason, pinned and hinted feeds", () => {
    expect(byId.get("deno-weekly")).toMatchObject({ enabled: false });
    expect(byId.get("deno-weekly")?.options.note).toMatch(/discontinued/);
    expect(byId.get("ryan-florence")).toMatchObject({ enabled: false });
    expect(byId.get("ryan-florence")?.options.note).toMatch(/remix-blog/);
    expect(byId.get("last-week-in-ai")).toMatchObject({
      type: "rss",
      feed_url: "https://lastweekin.ai/feed",
    });
    expect(byId.get("tldr-ai")?.options.feed_hint).toBe("https://tldr.tech/api/rss/ai");
    expect(byId.get("tldr")?.options.feed_hint).toBe("https://tldr.tech/api/rss/tech");
    expect(byId.get("javascript-weekly")?.options.kind).toBe("newsletter-issue");
  });

  it("holds YouTube channels disabled until their ids are resolved", () => {
    for (const id of ["fireship", "kevin-powell", "theo-t3gg", "hyperplexed"]) {
      expect(byId.get(id), id).toMatchObject({ type: "youtube", enabled: false });
      expect(byId.get(id)?.options.handle).toBeTruthy();
    }
  });

  it("adds the framework blogs from the Firecrawl watch list without duplicating known pages", () => {
    expect(byId.get("nextjs-blog")?.url).toBe("https://nextjs.org/blog");
    expect(file.sources.filter((s) => s.url.includes("openai.com/blog"))).toHaveLength(1);
    expect(file.sources.filter((s) => s.url.includes("ui.shadcn.com/docs/changelog"))).toHaveLength(
      1,
    );
  });

  it("derives twelve Exa queries with no years", () => {
    expect(queries.queries).toHaveLength(12);
    expect(queries.queries.slice(-2).map((q) => q.id)).toEqual([
      "consumer-hardware-and-platform-launches",
      "consumer-device-regulation-or-ruling",
    ]);
    expect(QueriesFile.safeParse(queries).success).toBe(true);
    for (const { query } of queries.queries) expect(query).not.toMatch(/\b20\d{2}\b/);
    expect(queries.queries[0]?.query).toBe("new UI component library release");
  });

  it("is deterministic", () => {
    expect(buildRegistry(markdown)).toEqual({ file, queries, warnings });
  });
});

describe("buildRegistry with an existing registry", () => {
  const fresh = buildRegistry(markdown).file;

  it("keeps discovered feeds, enabled flags, failure counters and added sources", () => {
    const rauno = fresh.sources.find((s) => s.id === "rauno-freiberg");
    if (!rauno) throw new Error("fixture changed");
    const existing = {
      version: 1 as const,
      sources: [
        {
          ...rauno,
          type: "rss" as const,
          feed_url: "https://rauno.me/feed.xml",
          failures: 2,
          last_ok: "2026-10-01T05:00:00.000Z",
        },
        makeSource({
          id: "my-own-source",
          url: "https://mine.example",
          feed_url: "https://mine.example/feed.xml",
        }),
      ],
    };
    const { file } = buildRegistry(markdown, existing);
    const merged = file.sources.find((s) => s.id === "rauno-freiberg");
    expect(merged).toMatchObject({
      type: "rss",
      feed_url: "https://rauno.me/feed.xml",
      failures: 2,
      last_ok: "2026-10-01T05:00:00.000Z",
    });
    expect(file.sources.at(-1)?.id).toBe("my-own-source");
    expect(file.sources.length).toBe(fresh.sources.length + 1);
  });

  it("does not put back the feed hint that discovery used up", () => {
    const josh = fresh.sources.find((s) => s.id === "josh-w-comeau");
    if (!josh) throw new Error("fixture changed");
    expect(josh.options.feed_hint).toBe("https://www.joshwcomeau.com/rss.xml");
    const { feed_hint: _hint, ...withoutHint } = josh.options;
    const discovered = {
      ...josh,
      type: "rss" as const,
      feed_url: "https://www.joshwcomeau.com/rss.xml",
      options: withoutHint,
    };
    const { file } = buildRegistry(markdown, { version: 1, sources: [discovered] });
    expect(file.sources.find((s) => s.id === "josh-w-comeau")).toEqual(discovered);
  });

  it("keeps the feed hint of a source that has no feed yet, so discovery can still use it", () => {
    const josh = fresh.sources.find((s) => s.id === "josh-w-comeau");
    if (!josh) throw new Error("fixture changed");
    const { feed_hint: _hint, ...withoutHint } = josh.options;
    const { file } = buildRegistry(markdown, {
      version: 1,
      sources: [{ ...josh, options: withoutHint }],
    });
    expect(file.sources.find((s) => s.id === "josh-w-comeau")?.options.feed_hint).toBe(
      "https://www.joshwcomeau.com/rss.xml",
    );
  });

  it("does not mark a resolved YouTube channel as unresolved again", () => {
    const fireship = fresh.sources.find((s) => s.id === "fireship");
    if (!fireship) throw new Error("fixture changed");
    expect(fireship.options.note).toMatch(/channel id not resolved yet/);
    const resolved = {
      ...fireship,
      enabled: true,
      feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA",
      options: { handle: "Fireship", channel_id: "UCsBjURrPoezykLs9EqgamOA" },
    };
    const { file } = buildRegistry(markdown, { version: 1, sources: [resolved] });
    expect(file.sources.find((s) => s.id === "fireship")).toEqual(resolved);
    // A channel that failed to resolve keeps the note discovery wrote for it.
    const failed = {
      ...fireship,
      options: { handle: "Fireship", note: "channel id not resolved: timed out" },
    };
    const again = buildRegistry(markdown, { version: 1, sources: [failed] }).file;
    expect(again.sources.find((s) => s.id === "fireship")?.options.note).toBe(
      "channel id not resolved: timed out",
    );
  });

  it("is a no-op over the committed registry: importing twice changes nothing", () => {
    const committed = parseSources(
      JSON.parse(readFileSync(new URL("../../../config/sources.json", import.meta.url), "utf8")),
    );
    const once = buildRegistry(markdown, committed).file;
    expect(once).toEqual(committed);
    expect(buildRegistry(markdown, once).file).toEqual(once);
  });

  it("respects a source the user disabled", () => {
    const josh = fresh.sources.find((s) => s.id === "josh-w-comeau");
    if (!josh) throw new Error("fixture changed");
    const { file } = buildRegistry(markdown, {
      version: 1,
      sources: [{ ...josh, enabled: false }],
    });
    expect(file.sources.find((s) => s.id === "josh-w-comeau")?.enabled).toBe(false);
  });
});
