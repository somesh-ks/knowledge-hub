import { describe, expect, it } from "vitest";
import { SOURCE_TYPES } from "./item.js";
import { deriveSourceFormat, Source, sourceFormat } from "./sources.js";

const base = {
  id: "a",
  name: "A",
  url: "https://a.example/",
  feed_url: null,
  tier: "daily",
  high_signal: false,
} as const;

describe("source format", () => {
  // Bug it prevents: a source without a format (every file written before the field) reading as
  // nothing, so it falls out of every format filter instead of following its type.
  it("falls back to the rule for the type when the file has no format", () => {
    const expected = {
      youtube: "video",
      github: "releases",
      producthunt: "releases",
      arxiv: "research",
      crossref: "research",
      hn: "forum",
      lobsters: "forum",
      rss: "blog",
      exa: "blog",
      firecrawl: "blog",
    } as const;
    expect(Object.keys(expected).sort()).toEqual([...SOURCE_TYPES].sort());
    for (const type of SOURCE_TYPES) {
      expect(deriveSourceFormat(type)).toBe(expected[type]);
      expect(sourceFormat(Source.parse({ ...base, type }))).toBe(expected[type]);
    }
  });

  it("lets a stored format win over the rule", () => {
    expect(sourceFormat(Source.parse({ ...base, type: "rss", format: "news" }))).toBe("news");
  });
});
