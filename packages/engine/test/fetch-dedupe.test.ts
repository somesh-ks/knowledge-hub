import type { SeenFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { dedupe } from "../src/dedupe/dedupe.js";
import { jaccard, titleTokens } from "../src/dedupe/titleTokens.js";
import { makeItem, makeSource } from "./fetch-helpers.js";

const emptySeen: SeenFile = { version: 1, items: {} };
const sources = [
  makeSource({ id: "src-a" }),
  makeSource({ id: "src-b" }),
  makeSource({ id: "craft", high_signal: true }),
  makeSource({ id: "hn", type: "hn" }),
  makeSource({ id: "digest", options: { kind: "newsletter-link" } }),
];

describe("title tokens", () => {
  it("lowercases, drops edge punctuation and the Show HN label, keeps inner punctuation", () => {
    expect([...titleTokens("Show HN: Springlet 2.0, retargets springs!")]).toEqual([
      "springlet",
      "2.0",
      "retargets",
      "springs",
    ]);
    expect([...titleTokens("shadcn@4.21.2 released")]).toEqual(["shadcn@4.21.2", "released"]);
  });

  it("computes Jaccard similarity", () => {
    expect(jaccard(new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "e"]))).toBeCloseTo(0.6);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });
});

describe("dedupe", () => {
  it("drops items already in seen.json", () => {
    const shown = makeItem({ url: "https://example.com/shown", title: "Shown before" });
    const fresh = makeItem({ url: "https://example.com/fresh", title: "Brand new" });
    const seen: SeenFile = { version: 1, items: { [shown.id]: "2026-10-01" } };
    const { items, report } = dedupe({ items: [shown, fresh], sources, seen });
    expect(items.map((i) => i.title)).toEqual(["Brand new"]);
    expect(report).toMatchObject({ input: 2, already_seen: 1, output: 1 });
  });

  // 2026-10-27: the copy the discovery search found of a story outranked the outlet's own feed entry,
  // because sources of equal signal fall back to the order of their ids, and "exa-discovery" sorts early.
  it("keeps the outlet's own feed entry over the copy the discovery search found of the same story", () => {
    const title = "Apple unveils a new iPad Pro with the faster M5 chip";
    const own = makeItem({ url: "https://outlet.example/ipad-pro", title, source_id: "src-b" });
    const copy = makeItem({ url: "https://syndicate.example/ipad-pro", title, source_id: "exa" });
    const withDiscovery = [...sources, makeSource({ id: "exa", type: "exa" })];
    const { items } = dedupe({ items: [copy, own], sources: withDiscovery, seen: emptySeen });
    expect(items.map((item) => item.source_id)).toEqual(["src-b"]);
  });

  it("keeps each story of a shared page when another source ranks first for its URL", () => {
    const url = "https://example.com/changelog";
    const other = makeItem({ url, title: "Changelog overview", source_id: "craft" });
    const v1 = makeItem({ url, title: "Springs get retargeting", id: "id-v1" });
    const v2 = makeItem({ url, title: "Gestures learn velocity", id: "id-v2" });
    const { items } = dedupe({ items: [v1, other, v2], sources, seen: emptySeen });
    expect(items.map((i) => i.id).sort()).toEqual([other.id, "id-v1", "id-v2"].sort());
  });

  it("gives a repeat of a shared page's story to the story with its id, not to a similar title earlier", () => {
    const url = "https://example.com/changelog";
    const first = makeItem({
      url,
      title: "Springs get retargeting",
      id: "id-a",
      source_id: "craft",
    });
    const second = makeItem({ url, title: "Gestures learn velocity", id: "id-b" });
    const repeat = makeItem({
      url,
      title: "Springs get retargeting",
      id: "id-b",
      source_id: "src-b",
      author: "someone",
    });
    const { items } = dedupe({ items: [first, second, repeat], sources, seen: emptySeen });
    expect(items.find((i) => i.id === "id-a")?.author).toBeUndefined();
    expect(items.find((i) => i.id === "id-b")?.author).toBe("someone");
  });

  it("collapses the same canonical URL and keeps the higher-signal source", () => {
    const fromBlog = makeItem({
      url: "https://example.com/post",
      title: "A post",
      source_id: "craft",
    });
    const fromAgg = makeItem({
      url: "https://example.com/post?utm_source=x",
      title: "A post, reposted",
      source_id: "src-a",
    });
    const { items, report } = dedupe({ items: [fromAgg, fromBlog], sources, seen: emptySeen });
    expect(items).toHaveLength(1);
    expect(items[0]?.source_id).toBe("craft");
    expect(report.same_url).toBe(1);
  });

  it("merges votes from the duplicate into the survivor", () => {
    const blog = makeItem({
      url: "https://example.com/post",
      title: "Why springs feel right",
      source_id: "craft",
    });
    const hn = makeItem({
      url: "https://example.com/post",
      title: "Why springs feel right",
      source_id: "hn",
      source_type: "hn",
      signals: { hn_points: 220, hn_comments: 90 },
      author: "someone",
    });
    const { items } = dedupe({ items: [blog, hn], sources, seen: emptySeen });
    expect(items[0]?.source_id).toBe("craft");
    expect(items[0]?.signals).toEqual({ hn_points: 220, hn_comments: 90 });
    expect(items[0]?.author).toBe("someone");
  });

  it("keeps the votes of every platform that carried a story", () => {
    const blog = makeItem({
      url: "https://example.com/post",
      title: "Why springs feel right",
      source_id: "craft",
      signals: { hn_points: 120 },
    });
    const reddit = makeItem({
      url: "https://example.com/post",
      title: "Why springs feel right",
      source_id: "reddit",
      source_type: "reddit",
      signals: { reddit_score: 640, reddit_comments: 95 },
    });
    const { items } = dedupe({ items: [blog, reddit], sources, seen: emptySeen });
    expect(items).toHaveLength(1);
    expect(items[0]?.signals).toEqual({ hn_points: 120, reddit_score: 640, reddit_comments: 95 });
  });

  it("collapses near-duplicate titles across sources, keeping the one with more HN points", () => {
    const low = makeItem({
      url: "https://a.example/launch",
      title: "Show HN: Springlet 2.0 retargets springs mid-flight",
      source_id: "hn",
      source_type: "hn",
      signals: { hn_points: 40 },
    });
    const high = makeItem({
      url: "https://b.example/springlet",
      title: "Springlet 2.0 retargets springs mid-flight",
      source_id: "src-b",
      signals: { hn_points: 150 },
    });
    const { items, report } = dedupe({ items: [low, high], sources, seen: emptySeen });
    expect(items).toHaveLength(1);
    expect(items[0]?.signals.hn_points).toBe(150);
    expect(items[0]?.canonical_url).toBe("https://b.example/springlet");
    expect(report.near_duplicate).toBe(1);
  });

  it("does not collapse similar titles from the same source (a release series)", () => {
    const one = makeItem({
      url: "https://example.com/r/1",
      title: "Springlet v2.0.1 release notes",
      source_id: "src-a",
    });
    const two = makeItem({
      url: "https://example.com/r/2",
      title: "Springlet v2.0.2 release notes",
      source_id: "src-a",
    });
    expect(dedupe({ items: [one, two], sources, seen: emptySeen }).items).toHaveLength(2);
  });

  it("does not collapse across sources when the titles differ enough", () => {
    const a = makeItem({
      url: "https://a.example/1",
      title: "Springs and drawers in practice",
      source_id: "src-a",
    });
    const b = makeItem({
      url: "https://b.example/2",
      title: "Springs and tokens in practice today",
      source_id: "src-b",
    });
    expect(dedupe({ items: [a, b], sources, seen: emptySeen }).items).toHaveLength(2);
  });

  it("ignores very short titles when matching near duplicates", () => {
    const a = makeItem({ url: "https://a.example/1", title: "Linear", source_id: "src-a" });
    const b = makeItem({ url: "https://b.example/2", title: "Linear", source_id: "src-b" });
    expect(dedupe({ items: [a, b], sources, seen: emptySeen }).items).toHaveLength(2);
  });

  it("uses the 0.8 Jaccard threshold: 4 of 5 shared tokens collapses, 3 of 5 does not", () => {
    const base = makeItem({
      url: "https://a.example/1",
      title: "one two three four",
      source_id: "src-a",
    });
    const close = makeItem({
      url: "https://b.example/2",
      title: "one two three four five",
      source_id: "src-b",
    });
    const far = makeItem({
      url: "https://c.example/3",
      title: "one two three six seven",
      source_id: "src-b",
    });
    expect(dedupe({ items: [base, close], sources, seen: emptySeen }).items).toHaveLength(1);
    expect(dedupe({ items: [base, far], sources, seen: emptySeen }).items).toHaveLength(2);
  });

  it("collapses a newsletter link into the original from the same host when it is in the pool", () => {
    const original = makeItem({
      url: "https://openai.com/index/gpt-next",
      title: "Introducing GPT Next",
      source_id: "src-a",
    });
    const roundup = makeItem({
      url: "https://openai.com/index/gpt-next-system-card",
      title: "Introducing GPT Next system card",
      source_id: "digest",
      snippet: "A recap",
    });
    const { items, report } = dedupe({ items: [original, roundup], sources, seen: emptySeen });
    expect(items.map((i) => i.source_id)).toEqual(["src-a"]);
    expect(report.newsletter_collapsed).toBe(1);
  });

  it("collapses a newsletter link whose path matches an original despite a different query", () => {
    const original = makeItem({
      url: "https://example.com/post",
      title: "Totally different headline here",
      source_id: "src-a",
    });
    const roundup = makeItem({
      url: "https://example.com/post?edition=12",
      title: "Link roundup entry",
      source_id: "digest",
    });
    expect(
      dedupe({ items: [original, roundup], sources, seen: emptySeen }).report.newsletter_collapsed,
    ).toBe(1);
  });

  it("keeps a newsletter link when no original from that host is in the pool", () => {
    const roundup = makeItem({
      url: "https://elsewhere.example/post",
      title: "A link only the roundup has",
      source_id: "digest",
    });
    const other = makeItem({
      url: "https://example.com/post",
      title: "Unrelated original",
      source_id: "src-a",
    });
    const { items, report } = dedupe({ items: [roundup, other], sources, seen: emptySeen });
    expect(items).toHaveLength(2);
    expect(report.newsletter_collapsed).toBe(0);
  });

  it("collapses by host only for sources marked newsletter-link, never for ordinary ones", () => {
    const original = makeItem({
      url: "https://example.com/a",
      title: "Introducing the thing",
      source_id: "src-a",
    });
    const ordinary = makeItem({
      url: "https://example.com/b",
      title: "Introducing the thing again",
      source_id: "src-b",
    });
    const { items } = dedupe({ items: [original, ordinary], sources, seen: emptySeen });
    expect(items).toHaveLength(2);
  });

  it("orders output newest first with id as the tie-break, whatever the input order", () => {
    const older = makeItem({
      url: "https://a.example/old",
      title: "Older entry about layouts",
      published_at: "2026-10-01T00:00:00.000Z",
    });
    const newer = makeItem({
      url: "https://b.example/new",
      title: "Newer entry about tokens",
      published_at: "2026-10-05T00:00:00.000Z",
    });
    const undated = makeItem({ url: "https://c.example/und", title: "Undated entry about motion" });
    delete (undated as { published_at?: string }).published_at;
    const forward = dedupe({ items: [older, newer, undated], sources, seen: emptySeen }).items.map(
      (i) => i.title,
    );
    const reversed = dedupe({ items: [undated, newer, older], sources, seen: emptySeen }).items.map(
      (i) => i.title,
    );
    expect(forward).toEqual([
      "Newer entry about tokens",
      "Older entry about layouts",
      "Undated entry about motion",
    ]);
    expect(reversed).toEqual(forward);
  });

  it("does not mutate its input", () => {
    const a = makeItem({
      url: "https://example.com/post",
      title: "Same story here",
      source_id: "craft",
    });
    const b = makeItem({
      url: "https://example.com/post",
      title: "Same story here",
      source_id: "hn",
      signals: { hn_points: 9 },
    });
    const snapshot = JSON.stringify([a, b]);
    dedupe({ items: [a, b], sources, seen: emptySeen });
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
