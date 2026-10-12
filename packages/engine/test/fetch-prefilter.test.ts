import { readFileSync } from "node:fs";
import { type Preferences, Preferences as PreferencesSchema } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { authorMatches, containsPhrase, keywordRegExp } from "../src/prefilter/phrase.js";
import { prefilter } from "../src/prefilter/prefilter.js";
import { releaseWeight } from "../src/prefilter/releaseWeight.js";
import { makeItem, makeSource, NOW } from "./fetch-helpers.js";

const preferences: Preferences = {
  ...PreferencesSchema.parse(
    JSON.parse(
      readFileSync(new URL("./fixtures/config/preferences.json", import.meta.url), "utf8"),
    ),
  ),
};

const sources = [
  makeSource({ id: "plain" }),
  makeSource({ id: "craft", high_signal: true, category_hint: "design_engineering_craft" }),
  makeSource({ id: "hn", type: "hn" }),
  makeSource({ id: "journal", type: "crossref", category_hint: "hci_empirical_research" }),
  makeSource({ id: "exa", type: "exa" }),
];

describe("phrase matching", () => {
  it("matches whole words and phrases case-insensitively, with an optional plural", () => {
    expect(keywordRegExp("shader").test("Dithered Shaders in WebGL")).toBe(true);
    expect(keywordRegExp("motion").test("On human emotion")).toBe(false);
    expect(keywordRegExp("design tokens").test("Design   Tokens, explained")).toBe(true);
    expect(keywordRegExp("three.js").test("Rendering with three.js today")).toBe(true);
    expect(keywordRegExp("three.js").test("threeXjs")).toBe(false);
  });

  it("matches disliked patterns as case-insensitive substrings", () => {
    expect(
      containsPhrase("TOP 10 AI Tools To Make You Rich!", "top 10 ai tools to make you rich"),
    ).toBe(true);
    expect(containsPhrase("something else", "10x your productivity")).toBe(false);
    expect(containsPhrase("anything", "")).toBe(false);
  });

  it("matches authors by whole name or handle, and ignores very short entries", () => {
    expect(authorMatches("Josh W. Comeau", "josh w comeau")).toBe(true);
    expect(authorMatches("Emil Kowalski, Someone Else", "emil kowalski")).toBe(true);
    expect(authorMatches("rauno freiberg", "rauno")).toBe(true);
    expect(authorMatches("Raunoslav", "rauno")).toBe(false);
    expect(authorMatches("Al", "al")).toBe(false);
    expect(authorMatches(undefined, "rauno")).toBe(false);
  });
});

describe("prefilter", () => {
  const run = (items: ReturnType<typeof makeItem>[], cap?: number) =>
    prefilter({ items, preferences, sources, now: NOW, ...(cap ? { cap } : {}) });

  it("hard-drops disliked patterns even from high-signal sources", () => {
    const bad = makeItem({
      url: "https://a.example/1",
      title: "10x your productivity with these prompts",
      source_id: "craft",
    });
    const alsoBad = makeItem({
      url: "https://a.example/2",
      title: "A shader walkthrough",
      snippet: "Sponsored partnership with a vendor",
      source_id: "plain",
    });
    const { items, report } = run([bad, alsoBad]);
    expect(items).toEqual([]);
    expect(report.dropped.disliked).toBe(2);
  });

  it("keeps items matching a preferred keyword in the title or snippet", () => {
    const inTitle = makeItem({
      url: "https://a.example/1",
      title: "Dithered shader tricks",
      source_id: "plain",
    });
    const inSnippet = makeItem({
      url: "https://a.example/2",
      title: "A short post",
      snippet: "Notes on spring physics for drawers",
      source_id: "plain",
    });
    const unrelated = makeItem({
      url: "https://a.example/3",
      title: "Quarterly earnings roundup",
      snippet: "Revenue grew.",
      source_id: "plain",
    });
    const { items, report } = run([inTitle, inSnippet, unrelated]);
    expect(items.map((i) => i.title).sort()).toEqual(["A short post", "Dithered shader tricks"]);
    expect(report.dropped.not_relevant).toBe(1);
  });

  it("keeps items from a preferred author without a keyword match", () => {
    const byAuthor = makeItem({
      url: "https://a.example/1",
      title: "Notes from this week",
      author: "Simon Willison",
      source_id: "plain",
    });
    expect(run([byAuthor]).items).toHaveLength(1);
  });

  it("keeps everything from a high-signal source", () => {
    const quiet = makeItem({
      url: "https://a.example/1",
      title: "A very plain title",
      source_id: "craft",
    });
    expect(run([quiet]).items).toHaveLength(1);
  });

  it("keeps strongly voted HN items over 100 points but not at exactly 100", () => {
    const strong = makeItem({
      url: "https://a.example/1",
      title: "Plain launch",
      source_id: "hn",
      signals: { hn_points: 101 },
    });
    const edge = makeItem({
      url: "https://a.example/2",
      title: "Another plain launch",
      source_id: "hn",
      signals: { hn_points: 100 },
    });
    expect(run([strong, edge]).items.map((i) => i.title)).toEqual(["Plain launch"]);
  });

  it("ranks keyword-rich, high-signal and well-voted items first, deterministically", () => {
    const keywordTitle = makeItem({
      url: "https://a.example/1",
      title: "Webgl shader and three.js notes",
      source_id: "plain",
    });
    const keywordSnippet = makeItem({
      url: "https://a.example/2",
      title: "Quiet title",
      snippet: "shader",
      source_id: "plain",
    });
    const trusted = makeItem({
      url: "https://a.example/3",
      title: "No keywords at all",
      source_id: "craft",
    });
    const forward = run([keywordSnippet, trusted, keywordTitle]).items.map((i) => i.title);
    const reversed = run([keywordTitle, trusted, keywordSnippet]).items.map((i) => i.title);
    expect(forward[0]).toBe("Webgl shader and three.js notes");
    expect(forward.at(-1)).toBe("Quiet title");
    expect(reversed).toEqual(forward);
  });

  it("prefers fresher items when everything else is equal", () => {
    const fresh = makeItem({
      url: "https://a.example/1",
      title: "Shader note one",
      source_id: "plain",
      published_at: "2026-10-06T04:00:00.000Z",
    });
    const stale = makeItem({
      url: "https://a.example/2",
      title: "Shader note two",
      source_id: "plain",
      published_at: "2026-09-30T04:00:00.000Z",
    });
    expect(run([stale, fresh]).items[0]?.title).toBe("Shader note one");
  });

  it("caps how much one source may contribute", () => {
    const flood = Array.from({ length: 20 }, (_, i) =>
      makeItem({ url: `https://a.example/${i}`, title: `Shader release ${i}`, source_id: "plain" }),
    );
    const { items, report } = run(flood);
    expect(items).toHaveLength(8);
    expect(report.dropped.source_cap).toBe(12);
  });

  it("lets a source override its cap, as the discovery source does", () => {
    const wide = [
      ...sources.filter((s) => s.id !== "plain"),
      makeSource({ id: "plain", options: { pool_cap: "12" } }),
    ];
    const flood = Array.from({ length: 20 }, (_, i) =>
      makeItem({ url: `https://a.example/${i}`, title: `Shader release ${i}`, source_id: "plain" }),
    );
    expect(prefilter({ items: flood, preferences, sources: wide, now: NOW }).items).toHaveLength(
      12,
    );
  });

  it("caps the pool at 60 by default and reports what the cap removed", () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      makeItem({
        url: `https://host${i}.example/x`,
        title: `Shader piece ${i}`,
        source_id: `s${i % 15}`,
      }),
    );
    const many15 = Array.from({ length: 15 }, (_, i) =>
      makeSource({ id: `s${i}`, options: { pool_cap: "20" } }),
    );
    const { items, report } = prefilter({ items: many, preferences, sources: many15, now: NOW });
    expect(items).toHaveLength(60);
    expect(report).toMatchObject({ input: 90, kept: 60 });
    expect(report.dropped.cap).toBe(30);
  });

  it("ranks a minor or major release above patch releases from the same repository", () => {
    const repo = makeSource({ id: "repo", type: "github", high_signal: true });
    const release = (version: string, snippet: string) =>
      makeItem({
        url: `https://github.com/acme/lib/releases/tag/v${version}`,
        title: `Lib: v${version}`,
        snippet,
        source_id: "repo",
        source_type: "github",
      });
    const patch = release("2.4.7", "Patch Changes fix a typo");
    const minor = release("2.5.0", "Minor Changes add a new prop");
    const major = release("3.0.0", "Major Changes drop the old API");
    const { items } = prefilter({
      items: [patch, minor, major],
      preferences,
      sources: [repo],
      now: NOW,
    });
    expect(items.map((i) => i.title)).toEqual(["Lib: v3.0.0", "Lib: v2.5.0", "Lib: v2.4.7"]);
  });

  it("limits a release feed to four items unless the source says otherwise", () => {
    const repo = makeSource({ id: "repo", type: "github", high_signal: true });
    const releases = Array.from({ length: 10 }, (_, i) =>
      makeItem({
        url: `https://github.com/acme/lib/releases/tag/v1.0.${i}`,
        title: `Lib: v1.0.${i}`,
        source_id: "repo",
        source_type: "github",
      }),
    );
    expect(
      prefilter({ items: releases, preferences, sources: [repo], now: NOW }).items,
    ).toHaveLength(4);
  });

  it("gives no release weight to items that are not GitHub releases", () => {
    expect(
      releaseWeight({ source_type: "rss", title: "v2.0.0 is out", snippet: "Major Changes" }),
    ).toBe(0);
    expect(releaseWeight({ source_type: "github", title: "Lib: v2.0.1", snippet: "" })).toBe(0);
  });

  it("accounts for every input item in the report", () => {
    const items = [
      makeItem({ url: "https://a.example/1", title: "10x your productivity", source_id: "plain" }),
      makeItem({ url: "https://a.example/2", title: "Unrelated thing", source_id: "plain" }),
      makeItem({ url: "https://a.example/3", title: "A shader post", source_id: "plain" }),
    ];
    const { report } = run(items);
    const dropped = Object.values(report.dropped).reduce((a, b) => a + b, 0);
    expect(report.kept + dropped).toBe(report.input);
  });

  it("returns an empty pool for an empty input", () => {
    expect(run([])).toEqual({
      items: [],
      report: {
        input: 0,
        kept: 0,
        dropped: { disliked: 0, not_relevant: 0, source_cap: 0, cap: 0 },
        tech: { input: 0, kept: 0, source_cap: 0, cap: 0 },
        trending: { input: 0, single_outlet: 0, kept: 0, source_cap: 0, cap: 0 },
      },
    });
  });
});

describe("prefilter: the consumer tech pool", () => {
  const TECH = "consumer_tech_releases" as const;
  /** Twelve tech outlets with the pool cap the registry gives them, plus the usual sources. */
  const outlets = Array.from({ length: 12 }, (_, i) =>
    makeSource({ id: `outlet-${i}`, category_hint: TECH, options: { pool_cap: "6" } }),
  );
  const all = [...sources, ...outlets];
  const run = (
    items: ReturnType<typeof makeItem>[],
    caps: { cap?: number; techCap?: number } = {},
  ) => prefilter({ items, preferences, sources: all, now: NOW, ...caps });

  let n = 0;
  /** A launch headline that matches no preferred keyword or author. */
  const launch = (source: string, overrides: Partial<ReturnType<typeof makeItem>> = {}) => {
    n += 1;
    return makeItem({
      url: `https://${source}.example/launch-${n}`,
      title: `Acme Phone ${n} goes on sale`,
      source_id: source,
      ...overrides,
    });
  };
  const craft = (i: number) =>
    makeItem({ url: `https://craft.example/${i}`, title: `Shader piece ${i}`, source_id: `c${i}` });

  it("lets a tech-hinted source through the relevance test that the same headline fails elsewhere", () => {
    const fromOutlet = launch("outlet-0");
    const fromBlog = launch("plain");
    const { items, report } = run([fromOutlet, fromBlog]);
    expect(items.map((i) => i.id)).toEqual([fromOutlet.id]);
    expect(report.dropped.not_relevant).toBe(1);
    expect(report.tech).toEqual({ input: 1, kept: 1, source_cap: 0, cap: 0 });
  });

  it("still hard-drops a disliked pattern from a tech source", () => {
    const { items, report } = run([
      launch("outlet-0", { title: "Sponsored partnership: Acme Phone goes on sale" }),
    ]);
    expect(items).toEqual([]);
    expect(report.dropped.disliked).toBe(1);
    expect(report.tech.input).toBe(0);
  });

  it("holds each outlet to its pool cap of six", () => {
    const flood = Array.from({ length: 10 }, () => launch("outlet-0"));
    const { items, report } = run(flood);
    expect(items).toHaveLength(6);
    expect(report.tech).toEqual({ input: 10, kept: 6, source_cap: 4, cap: 0 });
    expect(report.dropped.source_cap).toBe(4);
  });

  it("caps the tech pool at 20 without touching the main pool, and the other way round", () => {
    const tech = Array.from({ length: 36 }, (_, i) => launch(`outlet-${i % 12}`));
    const main = Array.from({ length: 70 }, (_, i) => craft(i));
    const { items, report } = run([...tech, ...main]);
    expect(report.kept).toBe(80);
    expect(items).toHaveLength(80);
    expect(report.tech).toEqual({ input: 36, kept: 20, source_cap: 0, cap: 16 });
    // Ten over the main cap plus sixteen over the tech cap.
    expect(report.dropped.cap).toBe(26);
    const techIds = new Set(tech.map((i) => i.id));
    expect(items.filter((i) => techIds.has(i.id))).toHaveLength(20);
    expect(items.filter((i) => !techIds.has(i.id))).toHaveLength(60);
  });

  it("lists the main pool first, then the tech pool, each best first", () => {
    const tech = [launch("outlet-0"), launch("outlet-1")];
    const main = [craft(0), craft(1)];
    const { items } = run([...tech, ...main]);
    const techIds = new Set(tech.map((i) => i.id));
    expect(items.map((i) => techIds.has(i.id))).toEqual([false, false, true, true]);
  });

  it("honours a custom tech cap and leaves the main cap alone", () => {
    const tech = Array.from({ length: 12 }, (_, i) => launch(`outlet-${i}`));
    const main = Array.from({ length: 5 }, (_, i) => craft(i));
    const result = run([...tech, ...main], { techCap: 3 });
    expect(result.report.tech).toMatchObject({ kept: 3, cap: 9 });
    expect(result.items).toHaveLength(8);
    const none = run([...tech, ...main], { techCap: 0 });
    expect(none.report.tech).toMatchObject({ kept: 0, cap: 12 });
    expect(none.items).toHaveLength(5);
  });

  it("ranks by coverage first: a story two outlets covered beats any single-source story", () => {
    const fresh = launch("outlet-0", { published_at: NOW.toISOString() });
    const covered = launch("outlet-1", {
      published_at: "2026-09-29T06:00:00.000Z",
      signals: { coverage: 2 },
    });
    const wide = launch("outlet-2", {
      published_at: "2026-09-29T06:00:00.000Z",
      signals: { coverage: 6 },
    });
    expect(run([fresh, covered, wide]).items.map((i) => i.id)).toEqual([
      wide.id,
      covered.id,
      fresh.id,
    ]);
  });

  it("scores a tech item as 2 x log2(1 + coverage) + recency", () => {
    // One week old: recency 0. Fresh: recency 1.
    const old = "2026-09-29T06:00:00.000Z";
    const single = launch("outlet-0", { published_at: NOW.toISOString() });
    const pair = launch("outlet-1", { published_at: old, signals: { coverage: 2 } });
    // 2 x log2(2) + 1 = 3 for the fresh single; 2 x log2(3) + 0 = 3.17 for the old pair.
    expect(run([single, pair]).items[0]?.id).toBe(pair.id);
    // With the same coverage the fresher item leads.
    const freshPair = launch("outlet-2", {
      published_at: NOW.toISOString(),
      signals: { coverage: 2 },
    });
    expect(run([pair, freshPair]).items[0]?.id).toBe(freshPair.id);
  });

  it("breaks ties by id, so the order never depends on the input order", () => {
    const pool = Array.from({ length: 8 }, (_, i) => launch(`outlet-${i}`));
    const forward = run(pool).items.map((i) => i.id);
    expect(run([...pool].reverse()).items.map((i) => i.id)).toEqual(forward);
    expect(forward).toEqual([...forward].sort());
  });

  it("ignores craft keywords, authors and votes when ranking tech: coverage decides", () => {
    const keyworded = launch("outlet-0", {
      title: "Acme Phone shader demo with spring physics",
      author: "Emil Kowalski",
      signals: { hn_points: 900 },
    });
    const covered = launch("outlet-1", { signals: { coverage: 3 } });
    expect(run([keyworded, covered]).items.map((i) => i.id)).toEqual([covered.id, keyworded.id]);
  });

  it("puts a discovery result into the tech pool when its query carried the hint", () => {
    const hinted = launch("exa", { source_type: "exa", category_hint: TECH });
    const unhinted = launch("exa", { source_type: "exa" });
    const { items, report } = run([hinted, unhinted]);
    expect(items.map((i) => i.id)).toEqual([hinted.id]);
    expect(report.tech.input).toBe(1);
    expect(report.dropped.not_relevant).toBe(1);
  });

  it("lets the source's own hint win over a query hint", () => {
    // A craft-hinted source stays in the main pool whatever hint an item carries.
    const item = makeItem({
      url: "https://craft.example/x",
      title: "A shader post",
      source_id: "craft",
      category_hint: TECH,
    });
    const { report } = run([item]);
    expect(report.tech.input).toBe(0);
    expect(report.kept).toBe(1);
  });

  it("uses a query hint for the category weight of a main-pool item", () => {
    const base = { title: "A shader post", source_id: "exa", source_type: "exa" as const };
    const liked = makeItem({
      ...base,
      url: "https://a.example/liked",
      category_hint: "design_engineering_craft",
    });
    const disliked = makeItem({
      ...base,
      url: "https://a.example/vc",
      category_hint: "venture_capital_and_gossip",
    });
    expect(run([disliked, liked]).items.map((i) => i.id)).toEqual([liked.id, disliked.id]);
  });

  it("accounts for every input item across both pools", () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, i) => launch(`outlet-${i % 3}`)),
      ...Array.from({ length: 5 }, (_, i) => craft(i)),
      launch("plain"),
      launch("outlet-0", { title: "10x your productivity with Acme Phone" }),
    ];
    const { report, items } = run(pool);
    const dropped = Object.values(report.dropped).reduce((a, b) => a + b, 0);
    expect(report.kept + dropped).toBe(report.input);
    expect(report.kept).toBe(items.length);
    expect(report.tech.input).toBe(report.tech.kept + report.tech.source_cap + report.tech.cap);
    expect(report.tech).toEqual({ input: 30, kept: 18, source_cap: 12, cap: 0 });
  });
});
