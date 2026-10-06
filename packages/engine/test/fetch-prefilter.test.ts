import { readFileSync } from "node:fs";
import { type Preferences, Preferences as PreferencesSchema } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { authorMatches, containsPhrase, keywordRegExp } from "../src/prefilter/phrase.js";
import { prefilter } from "../src/prefilter/prefilter.js";
import { releaseWeight } from "../src/prefilter/releaseWeight.js";
import { makeItem, makeSource, NOW } from "./fetch-helpers.js";

const preferences: Preferences = {
  ...PreferencesSchema.parse(
    JSON.parse(readFileSync(new URL("../../../config/preferences.json", import.meta.url), "utf8")),
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
      },
    });
  });
});
