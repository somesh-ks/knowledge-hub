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

  it("reads the real registry file: ten queries, twenty-one watch URLs, dozens of rows", () => {
    const parsed = parseSourcesMd(markdown);
    expect(parsed.exaQueries).toHaveLength(10);
    expect(parsed.watchUrls).toHaveLength(21);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(80);
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
    expect(file.sources.length).toBeGreaterThanOrEqual(95);
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

  it("derives ten Exa queries with no years", () => {
    expect(queries.queries).toHaveLength(10);
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
