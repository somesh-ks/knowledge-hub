import type { Item, SourceCandidatesFile, Topic, TopicJudgmentEntry } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeConfigCommand } from "../src/commands/config.js";
import { makeSourcesCommand } from "../src/commands/sources.js";
import { ALLOWLISTS, findViolations } from "../src/git/guard.js";
import { createHttpClient } from "../src/http.js";
import {
  collectDomains,
  createExaSearch,
  freshnessOf,
  MAX_SUGGESTED,
  MIN_QUALITY,
  passRateOf,
  priorOf,
  QUALITY_WEIGHTS,
  qualityOf,
  type SuggestDeps,
  suggestForTopic,
  suggestionQueries,
} from "../src/sources/suggest.js";
import { fakeFetch, makeDeps } from "./fetch-helpers.js";
import { type ConfigRepo, configRepo, datedEntries, rssFeed } from "./topics-helpers.js";

const NOW = new Date("2026-10-07T06:00:00Z");

const quantum: Topic = {
  id: "quantum_computing",
  name: "Quantum computing",
  description: "Hardware, algorithms and error correction.",
  weight: 0.7,
  enabled: true,
  keywords: ["qubit", "error correction"],
  section_id: "quantum_computing",
  never_publish: false,
  origin: "custom",
  depth: "fit_only",
};

const feedLink = '<link rel="alternate" type="application/rss+xml" href="/feed.xml">';
const page = (head = feedLink): string =>
  `<!doctype html><html><head>${head}</head><body>x</body></html>`;

interface Site {
  host: string;
  /** Feed entries; null serves a page with no feed. */
  entries: ReturnType<typeof datedEntries> | null;
  /** Fit the fake judge gives every item of the site, 0 to 1. */
  fit: number;
  /** How many of the three queries return the site. */
  hits: number;
}

const stale = (host: string) => datedEntries(host, 8, NOW, 40, 3);

const SITES: Site[] = [
  { host: "good.example", entries: datedEntries("good.example", 8, NOW), fit: 1, hits: 3 },
  {
    host: "second.example",
    entries: datedEntries("second.example", 8, NOW, 2),
    fit: 0.75,
    hits: 2,
  },
  { host: "third.example", entries: datedEntries("third.example", 6, NOW, 3), fit: 0.75, hits: 1 },
  {
    host: "fourth.example",
    entries: datedEntries("fourth.example", 6, NOW, 4),
    fit: 0.75,
    hits: 1,
  },
  { host: "low.example", entries: datedEntries("low.example", 8, NOW), fit: 0.25, hits: 1 },
  { host: "stale.example", entries: stale("stale.example"), fit: 1, hits: 1 },
  { host: "thin.example", entries: datedEntries("thin.example", 3, NOW), fit: 1, hits: 1 },
  { host: "nofeed.example", entries: null, fit: 1, hits: 1 },
];

function routesFor(sites: readonly Site[]): Record<string, string> {
  const routes: Record<string, string> = {};
  for (const site of sites) {
    routes[`https://${site.host}/feed.xml`] = rssFeed(site.host, site.entries ?? []);
    routes[`https://${site.host}/`] = page(site.entries ? feedLink : "<title>none</title>");
  }
  return routes;
}

/** Search results: site n is returned by the first `hits` queries, plus noise that must be skipped. */
function searchFor(sites: readonly Site[], extra: string[] = []) {
  const queries: string[] = [];
  const search = vi.fn(async (query: string) => {
    const index = queries.push(query) - 1;
    return [
      ...sites
        .filter((site) => site.hits > index)
        .map((site) => `https://${site.host}/posts/a-post`),
      ...extra,
    ];
  });
  return { search, queries };
}

function judgeBy(sites: readonly Site[]) {
  const asked: Item[] = [];
  return {
    asked,
    model: "jev-test",
    async judge(requests: readonly { item: Item; topics: readonly Topic[] }[]) {
      const entries: TopicJudgmentEntry[] = [];
      for (const { item, topics } of requests) {
        asked.push(item);
        const host = new URL(item.url).host;
        const fit = sites.find((site) => site.host === host)?.fit ?? 0;
        for (const topic of topics) {
          entries.push({
            item_id: item.id,
            topic_id: topic.id,
            topic_hash: "h",
            model: "jev-test",
            judged_at: NOW.toISOString(),
            fit,
          });
        }
      }
      return entries;
    },
  };
}

function depsFor(sites: readonly Site[], extra: string[] = []) {
  const fake = fakeFetch(routesFor(sites));
  const { search, queries } = searchFor(sites, extra);
  const judge = judgeBy(sites);
  const deps: SuggestDeps = { http: makeDeps(fake).http, search, judge, now: () => NOW };
  return { deps, fake, search, queries, judge };
}

describe("the three searches", () => {
  it("come from the name, the description and the keywords", () => {
    expect(suggestionQueries(quantum)).toEqual([
      "Quantum computing qubit error correction",
      "Hardware, algorithms and error correction.",
      "blog or newsletter about Quantum computing: qubit, error correction",
    ]);
    expect(suggestionQueries({ ...quantum, keywords: [] })).toEqual([
      "Quantum computing",
      "Hardware, algorithms and error correction.",
      "blog or newsletter about Quantum computing",
    ]);
  });
});

describe("the quality score", () => {
  it("weighs fit 0.35, pass rate 0.25, freshness 0.15, reliability 0.15 and prior 0.10", () => {
    expect(QUALITY_WEIGHTS).toEqual({
      fit: 0.35,
      pass_rate: 0.25,
      freshness: 0.15,
      reliability: 0.15,
      prior: 0.1,
    });
    expect(qualityOf({ fit: 1, pass_rate: 1, freshness: 1, reliability: 1, prior: 1 })).toBe(1);
    expect(qualityOf({ fit: 0, pass_rate: 0, freshness: 0, reliability: 0, prior: 0 })).toBe(0);
    expect(
      qualityOf({ fit: 0.8, pass_rate: 0.5, freshness: 0.4, reliability: 1, prior: 0.6 }),
    ).toBe(0.35 * 0.8 + 0.25 * 0.5 + 0.15 * 0.4 + 0.15 * 1 + 0.1 * 0.6);
  });

  it("counts the share of sampled items that clear the bar on fit alone", () => {
    expect(passRateOf([], 0.7)).toBe(0);
    expect(passRateOf([1, 0.75, 0.5, 0.25], 0.7)).toBe(0.5);
    expect(passRateOf([1, 0.75], 0.2)).toBe(0);
  });

  it("rewards a feed that posted this week and posts often", () => {
    expect(freshnessOf(1, 8)).toBe(1);
    expect(freshnessOf(7, 4)).toBe(1);
    expect(freshnessOf(30, 1)).toBe(0.1);
    expect(freshnessOf(18.5, 2)).toBe(0.5);
  });

  it("raises the prior with each search that agrees, and lowers it for a link roundup", () => {
    expect(priorOf(1, false)).toBe(0.4);
    expect(priorOf(3, false)).toBe(0.8);
    expect(priorOf(3, true)).toBe(0.6);
    expect(priorOf(9, false)).toBe(1);
  });
});

describe("collecting domains", () => {
  it("skips social sites and followed hosts, and orders by how many searches agree", () => {
    const found = collectDomains(
      [
        ["https://www.once.example/a", "https://twitter.com/x", "https://followed.example/p"],
        ["https://twice.example/a", "https://once.example/b", "https://twice.example/c"],
        ["https://twice.example/d", "https://github.com/o/r"],
      ],
      new Set(["followed.example"]),
    );
    // Both were returned by two searches, so the one seen first leads.
    expect(found).toEqual([
      { origin: "https://www.once.example", host: "once.example", queriesHit: 2 },
      { origin: "https://twice.example", host: "twice.example", queriesHit: 2 },
    ]);
  });
});

describe("suggestForTopic", () => {
  const input = {
    topic: quantum,
    existing: [
      { id: "alpha", url: "https://alpha.example/", feed_url: "https://alpha.example/feed.xml" },
    ],
  };

  it("validates feeds, scores them and adds the top three at 0.6 or better", async () => {
    const { deps, queries } = depsFor(SITES, [
      "https://twitter.com/someone/status/1",
      "https://alpha.example/posts/followed",
    ]);
    const result = await suggestForTopic(input, deps);

    expect(queries).toEqual(suggestionQueries(quantum));
    expect(result.queries).toEqual(queries);
    expect(MAX_SUGGESTED).toBe(6);
    expect(MIN_QUALITY).toBe(0.6);

    const byHost = Object.fromEntries(result.candidates.map((c) => [new URL(c.url).host, c]));
    // Every candidate is reported, accepted or not; skipped hosts never become candidates.
    expect(Object.keys(byHost).sort()).toEqual(SITES.map((s) => s.host).sort());

    // good.example: fit 1, every item passes, fresh, well formed, three searches agree.
    expect(byHost["good.example"]).toMatchObject({
      status: "suggested",
      q: 0.98,
      parts: { fit: 1, pass_rate: 1, freshness: 1, reliability: 1, prior: 0.8 },
      entries: 8,
      recent_entries: 8,
      feed_url: "https://good.example/feed.xml",
    });
    expect(byHost["second.example"]).toMatchObject({ status: "suggested", parts: { fit: 0.75 } });
    expect(byHost["low.example"]).toMatchObject({
      status: "below_bar",
      parts: { fit: 0.25, pass_rate: 0 },
    });
    expect(byHost["low.example"]?.q).toBeLessThan(MIN_QUALITY);
    expect(byHost["stale.example"]).toMatchObject({
      status: "rejected",
      q: null,
      parts: null,
      reason: "nothing published in the last 30 days",
    });
    expect(byHost["thin.example"]).toMatchObject({
      status: "rejected",
      reason: "only 3 entries; at least 5 are needed",
    });
    expect(byHost["nofeed.example"]).toMatchObject({ status: "rejected", reason: "no feed found" });

    // The four good sites are suggested; nothing is added to the registry (D40).
    expect(result).not.toHaveProperty("added");
    const good = ["good.example", "second.example", "third.example", "fourth.example"];
    expect(good.map((host) => byHost[host]?.status)).toEqual(Array(4).fill("suggested"));
    expect(MAX_SUGGESTED).toBeGreaterThanOrEqual(4);
  });

  it("suggests at most MAX_SUGGESTED, the rest are marked not_top", async () => {
    const many: Site[] = Array.from({ length: MAX_SUGGESTED + 2 }, (_, n) => ({
      host: `site${n}.example`,
      entries: datedEntries(`site${n}.example`, 8, NOW, n),
      fit: 1,
      hits: 1,
    }));
    const { deps } = depsFor(many);
    const result = await suggestForTopic(input, deps);
    const count = (status: string) => result.candidates.filter((c) => c.status === status).length;
    expect(count("suggested")).toBe(MAX_SUGGESTED);
    expect(count("not_top")).toBe(2);
  });

  it("takes the fit from at most eight recent items per feed", async () => {
    const { deps, judge } = depsFor([SITES[0] as Site]);
    await suggestForTopic(input, deps);
    expect(judge.asked).toHaveLength(8);
    expect(new Set(judge.asked.map((item) => item.id)).size).toBe(8);
  });

  it("scores a feed the judge could not answer as no fit, with a reason", async () => {
    const { deps } = depsFor([SITES[0] as Site]);
    deps.judge = { model: "jev-test", judge: async () => [] };
    const result = await suggestForTopic(input, deps);
    expect(result.candidates[0]).toMatchObject({
      status: "below_bar",
      parts: { fit: 0, pass_rate: 0 },
      reason: "the topic judge answered no items",
    });
    expect(result.candidates.some((c) => c.status === "suggested")).toBe(false);
  });

  it("fails only when every search fails, and a failed search costs nothing else", async () => {
    const { deps } = depsFor([SITES[0] as Site]);
    let n = 0;
    deps.search = async () => {
      n += 1;
      if (n === 1) throw new Error("rate limited");
      return ["https://good.example/posts/a-post"];
    };
    expect((await suggestForTopic(input, deps)).candidates).toHaveLength(1);
    deps.search = async () => {
      throw new Error("Exa is down");
    };
    await expect(suggestForTopic(input, deps)).rejects.toThrow("every search failed: Exa is down");
  });

  it("never touches the network beyond the injected client", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const { deps, fake } = depsFor(SITES);
    await suggestForTopic(input, deps);
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((url) => /^https:\/\/[a-z]+\.example\//.test(url))).toBe(true);
  });
});

describe("the Exa search", () => {
  it("posts the query with the key and returns the result links", async () => {
    let seen: { url: string; body: unknown; key: string | null } | undefined;
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      seen = {
        url,
        body: JSON.parse(String(init?.body)),
        key: new Headers(init?.headers).get("x-api-key"),
      };
      return Response.json({
        results: [{ url: "https://a.example/x", title: "A" }, { url: "https://b.example/y" }],
      });
    };
    const http = createHttpClient({ fetchImpl, retries: 0 });
    const urls = await createExaSearch(http, "test-key", "https://exa.test/")("qubits");
    expect(urls).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(seen).toEqual({
      url: "https://exa.test/search",
      body: { query: "qubits", type: "auto", numResults: 10 },
      key: "test-key",
    });
  });

  it("rejects an unexpected response shape", async () => {
    const http = createHttpClient({
      fetchImpl: async () => Response.json({ nope: 1 }),
      retries: 0,
    });
    await expect(createExaSearch(http, "k")("q")).rejects.toThrow("unexpected Exa response shape");
  });
});

describe("dispatch sources suggest", () => {
  let repo: ConfigRepo;
  let out: string[];

  beforeEach(async () => {
    repo = await configRepo(NOW);
    out = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const op = {
      op: "topic.upsert",
      topic: { name: quantum.name, description: quantum.description, keywords: quantum.keywords },
    };
    expect(await makeConfigCommand()(["apply", "--op", JSON.stringify(op)], repo.context())).toBe(
      0,
    );
    out.length = 0;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await repo.cleanup();
  });

  const command = (sites: readonly Site[] = SITES) => makeSourcesCommand(() => depsFor(sites).deps);

  it("records every candidate, adds no source, and writes only files the config command may", async () => {
    expect(await command()(["suggest", "--topic", "quantum_computing"], repo.context())).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({
      topic: "quantum_computing",
      candidates: SITES.length,
      dry_run: false,
    });

    // Discovery only suggests: the registry the owner edits is untouched.
    expect(repo.dirty()).not.toContain("config/sources.user.json");

    const candidates = await repo.readJson<SourceCandidatesFile>("state/source-candidates.json");
    const entry = candidates.topics.quantum_computing;
    expect(entry?.suggested_at).toBe(NOW.toISOString());
    expect(entry?.queries).toEqual(suggestionQueries({ ...quantum, keywords: quantum.keywords }));
    expect(entry?.candidates).toHaveLength(SITES.length);
    // Best first, rejected last.
    const scores = entry?.candidates.map((c) => c.q ?? -1) ?? [];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    expect(findViolations(repo.dirty(), ALLOWLISTS.config)).toEqual([]);
    expect(repo.dirty()).toContain("state/source-candidates.json");
  });

  it("replaces the topic's candidates on a second run and lists each site once", async () => {
    await command()(["suggest", "--topic", "quantum_computing"], repo.context());
    await command()(["suggest", "--topic", "quantum_computing"], repo.context());
    const candidates = await repo.readJson<SourceCandidatesFile>("state/source-candidates.json");
    expect(Object.keys(candidates.topics)).toEqual(["quantum_computing"]);
    const entry = candidates.topics.quantum_computing?.candidates ?? [];
    expect(entry).toHaveLength(SITES.length);
    expect(entry.filter((c) => c.status === "suggested")).toHaveLength(4);
    expect(new Set(entry.map((c) => c.id)).size).toBe(entry.length);
  });

  it("writes nothing with --dry-run", async () => {
    const before = repo.dirty();
    await command()(["suggest", "--topic", "quantum_computing", "--dry-run"], repo.context());
    expect(repo.dirty()).toEqual(before);
  });

  it("refuses an unknown topic and a built-in one", async () => {
    expect(await command()(["suggest", "--topic", "nope"], repo.context())).toBe(1);
    expect(
      await command()(["suggest", "--topic", "design_engineering_craft"], repo.context()),
    ).toBe(1);
    expect(await command()(["suggest"], repo.context())).toBe(2);
  });
});
