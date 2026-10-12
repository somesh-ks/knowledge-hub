import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { feedsGeneralOnly, type SourcesFile, SourcesFile as SourcesSchema } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseQueries } from "../src/fetch/queries.js";
import {
  loadSources,
  parseSources,
  SourcesError,
  saveSources,
  serializeSources,
  validateSources,
} from "../src/sources/registry.js";
import { makeSource } from "./fetch-helpers.js";

const registry = (...sources: ReturnType<typeof makeSource>[]): SourcesFile => ({
  version: 1,
  sources,
});

describe("validateSources", () => {
  it("accepts well-formed sources of every type", () => {
    const file = registry(
      makeSource({ id: "blog" }),
      makeSource({
        id: "repo",
        type: "github",
        feed_url: "https://github.com/a/b/releases.atom",
        options: { repo: "a/b" },
      }),
      makeSource({
        id: "chan",
        type: "youtube",
        options: { channel_id: "UCsBjURrPoezykLs9EqgamOA" },
      }),
      makeSource({ id: "journal", type: "crossref", options: { issn: "1073-0516" } }),
      makeSource({ id: "scrape", type: "firecrawl", feed_url: null }),
      makeSource({ id: "hn", type: "hn" }),
    );
    expect(validateSources(file)).toEqual([]);
  });

  it("flags duplicate ids", () => {
    expect(validateSources(registry(makeSource({ id: "a" }), makeSource({ id: "a" })))).toEqual([
      "duplicate id a",
    ]);
  });

  it("flags enabled sources missing what their type needs", () => {
    const problems = validateSources(
      registry(
        makeSource({ id: "no-feed", feed_url: null }),
        makeSource({ id: "no-repo", type: "github" }),
        makeSource({ id: "bad-repo", type: "github", options: { repo: "just-a-name" } }),
        makeSource({ id: "no-channel", type: "youtube" }),
        makeSource({ id: "short-channel", type: "youtube", options: { channel_id: "UC123" } }),
        makeSource({ id: "no-issn", type: "crossref" }),
        makeSource({ id: "bad-issn", type: "crossref", options: { issn: "1234" } }),
      ),
    );
    expect(problems).toHaveLength(7);
    expect(problems.join("\n")).toMatch(/no-feed: rss needs feed_url/);
    expect(problems.join("\n")).toMatch(/short-channel: youtube needs options.channel_id/);
  });

  it("does not hold disabled sources to those requirements", () => {
    expect(
      validateSources(registry(makeSource({ id: "later", type: "youtube", enabled: false }))),
    ).toEqual([]);
  });
});

describe("parseSources", () => {
  it("applies schema defaults", () => {
    const parsed = parseSources({
      version: 1,
      sources: [
        {
          id: "a",
          name: "A",
          type: "rss",
          url: "https://a.example",
          feed_url: "https://a.example/feed",
          tier: "daily",
          high_signal: false,
        },
      ],
    });
    expect(parsed.sources[0]).toMatchObject({ enabled: true, failures: 0, options: {} });
  });

  it("lists every problem in one error", () => {
    const attempt = () =>
      parseSources({
        version: 1,
        sources: [
          {
            id: "Bad Id",
            name: "",
            type: "nope",
            url: "x",
            feed_url: null,
            tier: "hourly",
            high_signal: "yes",
          },
        ],
      });
    expect(attempt).toThrow(SourcesError);
    try {
      attempt();
    } catch (error) {
      expect((error as SourcesError).problems.length).toBeGreaterThan(3);
    }
  });

  it("rejects a registry that is schema-valid but semantically broken", () => {
    expect(() => parseSources(registry(makeSource({ id: "x", feed_url: null })))).toThrow(
      /rss needs feed_url/,
    );
  });
});

describe("serializeSources", () => {
  it("writes keys in schema order, sorts options, and ends with a newline", () => {
    const text = serializeSources(
      registry(
        makeSource({
          id: "a",
          high_signal: true,
          category_hint: "design_engineering_craft",
          options: { z: "1", a: "2" },
        }),
      ),
    );
    expect(text.endsWith("}\n")).toBe(true);
    const source = (JSON.parse(text) as SourcesFile).sources[0];
    expect(Object.keys(source ?? {})).toEqual([
      "id",
      "name",
      "type",
      "url",
      "feed_url",
      "tier",
      "high_signal",
      "category_hint",
      "enabled",
      "failures",
      "options",
    ]);
    expect(Object.keys(source?.options ?? {})).toEqual(["a", "z"]);
  });

  it("omits optional fields that are unset", () => {
    const parsed = JSON.parse(serializeSources(registry(makeSource({ id: "a" })))) as SourcesFile;
    expect(parsed.sources[0]).not.toHaveProperty("category_hint");
    expect(parsed.sources[0]).not.toHaveProperty("last_ok");
  });
});

describe("loading and saving", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dispatch-sources-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round trips through config/sources.json", async () => {
    const file = registry(
      makeSource({ id: "a" }),
      makeSource({ id: "b", tier: "weekly", high_signal: true }),
    );
    await saveSources(root, file);
    expect(await loadSources(root)).toEqual(file);
    expect(JSON.parse(await readFile(join(root, "config/sources.json"), "utf8"))).toHaveProperty(
      "version",
      1,
    );
  });

  it("points at the import command when the registry is missing", async () => {
    await expect(loadSources(root)).rejects.toThrow(/dispatch sources import/);
  });

  it("refuses to save an invalid registry", async () => {
    await expect(
      saveSources(root, registry(makeSource({ id: "x", feed_url: null }))),
    ).rejects.toThrow(SourcesError);
  });
});

// The live registry is owner-edited data: these are data lints over it, with no counts or ids pinned.
describe("the committed registry", () => {
  const path = new URL("../../../config/sources.json", import.meta.url);

  it("parses, with unique kebab-case ids, one fetch per feed, a strategy and a note where needed", () => {
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const { sources } = parseSources(SourcesSchema.parse(raw));
    expect(sources.length).toBeGreaterThanOrEqual(90);
    expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
    // Al Jazeera's top stories and its World desk share one feed; the top-stories source is off.
    const feeds = sources
      .filter((s) => s.enabled && s.feed_url)
      .map((s) => `${feedsGeneralOnly(s.topic_ids)} ${s.feed_url}`);
    expect(feeds.length).toBe(new Set(feeds).size);
    // Every source is filed under a topic (D69), except the Exa searches, which carry their own.
    const neverPublish = new Set(["venture_capital_and_gossip", "generic_ai_hype_listicles"]);
    const unfiled = sources.filter(
      (s) => s.category_hint === undefined && (s.topic_ids ?? []).length === 0,
    );
    expect(unfiled.map((s) => s.id)).toEqual(["exa-discovery"]);
    for (const source of sources) {
      expect(neverPublish.has(source.category_hint ?? ""), source.id).toBe(false);
      expect(source.topic_ids ?? [], source.id).not.toContain("trending");
      // No resolved source carries leftovers that discovery already used up.
      if (source.feed_url !== null)
        expect(source.options, source.id).not.toHaveProperty("feed_hint");
      if (source.options.channel_id) expect(source.options.note, source.id).toBeUndefined();
      if (!source.enabled) {
        expect(source.options.note, source.id).toBeTruthy();
        continue;
      }
      expect(source.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      const hasStrategy = source.feed_url !== null || source.type === "firecrawl";
      expect(hasStrategy, source.id).toBe(true);
    }
  });

  it("keeps discovery queries unique and free of years that go stale", () => {
    const queriesPath = new URL("../../../config/queries.json", import.meta.url);
    const { queries } = parseQueries(JSON.parse(readFileSync(queriesPath, "utf8")));
    expect(new Set(queries.map((q) => q.id)).size).toBe(queries.length);
    for (const { query } of queries) expect(query).not.toMatch(/\b20\d{2}\b/);
  });
});
