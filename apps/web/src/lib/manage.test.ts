import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORIES } from "@dispatch/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCandidates,
  buildSources,
  fallbackTopics,
  hostOf,
  humanize,
  loadManage,
  parseTopicsFile,
  pickDefaultSection,
  qualityInWords,
  recordInWords,
  stepToWeight,
  WEIGHT_STEPS,
  weightToStep,
} from "./manage";

describe("weight steps", () => {
  it("has the five words in order", () => {
    expect(WEIGHT_STEPS).toEqual(["Less", "A bit less", "Normal", "A bit more", "More"]);
  });

  it("maps a stored weight to the nearest step", () => {
    expect(weightToStep(0)).toBe(0);
    expect(weightToStep(0.02)).toBe(0);
    expect(weightToStep(0.3)).toBe(1);
    expect(weightToStep(0.5)).toBe(2);
    expect(weightToStep(0.72)).toBe(3);
    expect(weightToStep(0.95)).toBe(4);
    expect(weightToStep(1)).toBe(4);
  });

  it("keeps a weight outside 0 to 1 and a broken one on the control", () => {
    expect(weightToStep(-3)).toBe(0);
    expect(weightToStep(7)).toBe(4);
    expect(weightToStep(Number.NaN)).toBe(2);
  });

  it("maps a step back to a weight in 0 to 1, and the two agree", () => {
    expect([0, 1, 2, 3, 4].map(stepToWeight)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const step of [0, 1, 2, 3, 4]) expect(weightToStep(stepToWeight(step))).toBe(step);
  });
});

describe("hostOf", () => {
  it("returns the host without www", () => {
    expect(hostOf("https://www.example.com/blog")).toBe("example.com");
    expect(hostOf("https://blog.example.com/")).toBe("blog.example.com");
  });

  it("returns an empty string for anything that is not an address", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf(null)).toBe("");
    expect(hostOf(undefined)).toBe("");
  });
});

describe("recordInWords", () => {
  const stats = (judged: number, published: number, fetched = judged) => ({
    fetched,
    judged,
    passed: published,
    published,
  });

  it("says how many judged stories made a briefing", () => {
    expect(recordInWords(stats(40, 12, 52))).toBe("12 of 40 stories made a briefing");
    expect(recordInWords(stats(1, 1))).toBe("1 of 1 story made a briefing");
  });

  it("falls back to the stories fetched before judging was counted", () => {
    expect(recordInWords(stats(0, 3, 9))).toBe("3 of 9 stories made a briefing");
  });

  it("says so plainly when none made it", () => {
    expect(recordInWords(stats(30, 0))).toBe("None of 30 stories made a briefing");
    expect(recordInWords(stats(1, 0))).toBe("The 1 story did not make a briefing");
  });

  it("gives no record when there is nothing to count", () => {
    expect(recordInWords(null)).toBeNull();
    expect(recordInWords(stats(0, 0, 0))).toBeNull();
  });

  it("never claims more published than judged", () => {
    expect(recordInWords(stats(5, 9))).toBe("5 of 5 stories made a briefing");
  });
});

describe("qualityInWords", () => {
  it("names four bands", () => {
    expect(qualityInWords(0.9)).toBe("Strong match");
    expect(qualityInWords(0.75)).toBe("Strong match");
    expect(qualityInWords(0.6)).toBe("Good match");
    expect(qualityInWords(0.3)).toBe("Fair match");
    expect(qualityInWords(0.1)).toBe("Weak match");
  });

  it("reads a figure out of 100 the same way", () => {
    expect(qualityInWords(82)).toBe("Strong match");
    expect(qualityInWords(55)).toBe("Good match");
  });
});

describe("fallbackTopics", () => {
  it("lists every category as a built-in topic with its stored weight", () => {
    const topics = fallbackTopics({
      weights: { design_engineering_craft: 0.95, frontier_model_releases: 0.3 },
    });
    expect(topics.map((topic) => topic.id)).toEqual([...CATEGORIES]);
    expect(topics.every((topic) => topic.origin === "builtin")).toBe(true);
    const craft = topics.find((topic) => topic.id === "design_engineering_craft");
    expect(craft).toMatchObject({ name: "Design engineering craft", weight: 0.95, step: 4 });
    expect(topics.find((topic) => topic.id === "frontier_model_releases")?.step).toBe(1);
  });

  it("uses a middle weight when preferences are missing", () => {
    const topics = fallbackTopics(null);
    expect(topics.every((topic) => topic.weight === 0.5 && topic.step === 2)).toBe(true);
  });

  it("marks the categories that never publish and gives each a section and a description", () => {
    const topics = fallbackTopics(null);
    expect(topics.filter((topic) => topic.never_publish).map((topic) => topic.id)).toEqual([
      "venture_capital_and_gossip",
      "generic_ai_hype_listicles",
    ]);
    for (const topic of topics) {
      expect(topic.description, topic.id).not.toBe("");
      expect(topic.section_id, topic.id).not.toBe("");
    }
    expect(topics.find((topic) => topic.id === "consumer_tech_releases")?.section_id).toBe("tech");
  });
});

describe("parseTopicsFile", () => {
  const file = {
    version: 1,
    sections: [
      { id: "tech", title: "Tech releases", order: 2 },
      { id: "top", title: "Top picks", order: 0 },
    ],
    topics: [
      {
        id: "a_topic",
        name: "A topic",
        description: "About a thing.",
        weight: 0.9,
        enabled: false,
        keywords: ["one", "", 3, "two"],
        section_id: "tech",
        never_publish: false,
        origin: "custom",
        depth: 2,
      },
      { id: "broken" },
      null,
      { id: "plain", name: "Plain" },
    ],
  };

  it("reads topics, skips broken entries and sorts sections by order", () => {
    const parsed = parseTopicsFile(file);
    expect(parsed?.topics.map((topic) => topic.id)).toEqual(["a_topic", "plain"]);
    expect(parsed?.topics[0]).toMatchObject({
      enabled: false,
      keywords: ["one", "two"],
      origin: "custom",
      step: 4,
    });
    expect(parsed?.sections.map((section) => section.id)).toEqual(["top", "tech"]);
  });

  it("fills in what a plain entry leaves out", () => {
    const plain = parseTopicsFile(file)?.topics[1];
    expect(plain).toMatchObject({
      description: "",
      weight: 0.5,
      enabled: true,
      origin: "builtin",
      never_publish: false,
    });
  });

  it("returns null when the file is not usable, so the fallback applies", () => {
    expect(parseTopicsFile(null)).toBeNull();
    expect(parseTopicsFile({ topics: "no" })).toBeNull();
    expect(parseTopicsFile({ topics: [{ id: "x" }] })).toBeNull();
  });
});

describe("pickDefaultSection", () => {
  it("prefers Tech releases, then the last section", () => {
    expect(
      pickDefaultSection([
        { id: "top", title: "Top", order: 0 },
        { id: "tech", title: "Tech", order: 1 },
        { id: "watch", title: "Watch", order: 2 },
      ]),
    ).toBe("tech");
    expect(
      pickDefaultSection([
        { id: "top", title: "Top", order: 0 },
        { id: "watch", title: "Watch", order: 1 },
      ]),
    ).toBe("watch");
  });
});

describe("buildSources", () => {
  const registry = {
    sources: [
      { id: "zeta-blog", name: "Zeta Blog", url: "https://www.zeta.example/", enabled: true },
      { id: "alpha-blog", name: "Alpha Blog", url: "https://alpha.example/", enabled: true },
      { id: "off-blog", name: "Off Blog", url: "https://off.example/", enabled: false },
      { id: "gone-blog", name: "Gone Blog", url: "https://gone.example/", enabled: true },
      { id: "flaky", name: "Flaky", url: "https://flaky.example/", enabled: true, failures: 0 },
      { notASource: true },
    ],
  };
  const user = {
    added: [{ id: "mine", name: "Mine", url: "https://mine.example/", enabled: true }],
    overrides: {
      "zeta-blog": { pinned: true },
      "off-blog": { enabled: true },
      "gone-blog": { removed: true },
      "alpha-blog": { enabled: false },
    },
  };

  it("merges the registry with added sources and applies the overrides", () => {
    const rows = buildSources({ registry, user, stats: null, health: null });
    expect(rows.map((row) => row.id)).toEqual([
      "zeta-blog",
      "alpha-blog",
      "flaky",
      "mine",
      "off-blog",
    ]);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId["zeta-blog"]).toMatchObject({ pinned: true, host: "zeta.example" });
    expect(byId["off-blog"]?.enabled).toBe(true);
    expect(byId["alpha-blog"]?.enabled).toBe(false);
    expect(byId["gone-blog"]).toBeUndefined();
  });

  it("works with no user file at all", () => {
    const rows = buildSources({ registry, user: null, stats: null, health: null });
    expect(rows.map((row) => row.id)).toContain("gone-blog");
    expect(rows.every((row) => !row.pinned)).toBe(true);
  });

  it("puts the record in words and flags a source that keeps failing", () => {
    const rows = buildSources({
      registry,
      user: null,
      stats: { sources: { "alpha-blog": { fetched: 50, judged: 40, passed: 9, published: 12 } } },
      health: { sources: { flaky: { failures: 4, last_ok: "2026-10-01T00:00:00.000Z" } } },
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId["alpha-blog"]?.record).toBe("12 of 40 stories made a briefing");
    expect(byId["zeta-blog"]?.record).toBeNull();
    expect(byId.flaky?.struggling).toBe(true);
    expect(byId["alpha-blog"]?.struggling).toBe(false);
  });

  it("builds lowercase search text from the name, host and id", () => {
    const rows = buildSources({ registry, user: null, stats: null, health: null });
    expect(rows.find((row) => row.id === "zeta-blog")?.search).toBe(
      "zeta blog zeta.example zeta-blog",
    );
  });
});

describe("buildCandidates", () => {
  const topics = fallbackTopics(null);
  const file = {
    topic_id: "design_engineering_craft",
    candidates: [
      { feed_url: "https://b.example/feed", domain: "b.example", q: 0.55, sample_n: 1 },
      { feed_url: "https://a.example/feed", domain: "a.example", q: 0.9, sample_n: 8 },
      { feed_url: "https://known.example/feed/", domain: "known.example", q: 0.99, sample_n: 3 },
      { feed_url: "not a url", domain: "bad.example", q: 0.9 },
      { domain: "nofeed.example", q: 0.9 },
    ],
  };

  it("lists the best first, with the quality in words and what it is based on", () => {
    const candidates = buildCandidates(file, topics, ["https://known.example/feed"]);
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["a.example", "b.example"]);
    expect(candidates[0]).toMatchObject({
      quality: "Strong match",
      detail: "Strong match for Design engineering craft, from 8 recent stories",
      topic_id: "design_engineering_craft",
      feed_url: "https://a.example/feed",
    });
    expect(candidates[1]?.detail).toBe(
      "Good match for Design engineering craft, from 1 recent story",
    );
  });

  it("leaves out a feed that is already a source", () => {
    const candidates = buildCandidates(file, topics, [
      "https://A.example/feed/",
      "https://known.example/feed",
    ]);
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["b.example"]);
  });

  it("copes with a missing file and an unknown topic", () => {
    expect(buildCandidates(null, topics, [])).toEqual([]);
    expect(buildCandidates({ candidates: "no" }, topics, [])).toEqual([]);
    const unknown = buildCandidates({ ...file, topic_id: "gone" }, topics, []);
    expect(unknown[0]?.detail).toBe("Strong match, from 3 recent stories");
  });
});

describe("humanize", () => {
  it("turns an id into a name", () => {
    expect(humanize("css_canvas_motion_techniques")).toBe("Css canvas motion techniques");
    expect(humanize("audio-interfaces")).toBe("Audio interfaces");
  });
});

describe("loadManage", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  async function repo(files: Record<string, unknown>): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "manage-"));
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(
        join(dir, path),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    }
    return dir;
  }

  it("falls back to the categories and the stored weights when the engine's files are missing", async () => {
    const root = await repo({
      "config/preferences.json": { weights: { design_engineering_craft: 0.2 } },
      "config/sources.json": { sources: [{ id: "one", name: "One", url: "https://one.example/" }] },
    });
    const data = await loadManage({ root, env: {} });
    expect(data.topics).toHaveLength(CATEGORIES.length);
    expect(data.topics[0]).toMatchObject({ id: "design_engineering_craft", step: 1 });
    expect(data.sections.length).toBeGreaterThan(0);
    expect(data.defaultSectionId).toBe("tech");
    expect(data.sources.map((source) => source.id)).toEqual(["one"]);
    expect(data.candidates).toEqual([]);
  });

  it("survives files that are not JSON", async () => {
    const root = await repo({
      "config/topics.json": "{ not json",
      "config/sources.json": "",
      "state/source-stats.json": "[[",
    });
    const data = await loadManage({ root, env: {} });
    expect(data.topics).toHaveLength(CATEGORIES.length);
    expect(data.sources).toEqual([]);
  });

  it("reads the engine's files when they exist", async () => {
    const root = await repo({
      "config/topics.json": {
        version: 1,
        sections: [{ id: "tech", title: "Tech releases", order: 0 }],
        topics: [{ id: "mine", name: "Mine", description: "Mine.", weight: 1, origin: "custom" }],
      },
      "config/sources.json": { sources: [{ id: "one", name: "One", url: "https://one.example/" }] },
      "config/sources.user.json": { added: [], overrides: { one: { pinned: true } } },
      "state/source-stats.json": { sources: { one: { fetched: 4, judged: 4, published: 2 } } },
      "state/source-candidates.json": {
        topic_id: "mine",
        candidates: [{ feed_url: "https://new.example/feed", domain: "new.example", q: 0.8 }],
      },
    });
    const data = await loadManage({ root, env: {} });
    expect(data.topics.map((topic) => topic.id)).toEqual(["mine"]);
    expect(data.sources[0]).toMatchObject({
      pinned: true,
      record: "2 of 4 stories made a briefing",
    });
    expect(data.candidates[0]).toMatchObject({ domain: "new.example", quality: "Strong match" });
  });

  it("reads the invented fixtures, and only the fixtures, when asked", async () => {
    const root = await repo({
      "config/sources.json": {
        sources: [{ id: "real", name: "Real", url: "https://real.example/" }],
      },
      "apps/web/src/fixtures/config/sources.json": {
        sources: [{ id: "invented", name: "Invented", url: "https://invented.example/" }],
      },
    });
    const real = await loadManage({ root, env: {} });
    expect(real.sources.map((source) => source.id)).toEqual(["real"]);
    const fixtures = await loadManage({ root, env: { DISPATCH_FIXTURES: "1" } });
    expect(fixtures.sources.map((source) => source.id)).toEqual(["invented"]);
  });
});
