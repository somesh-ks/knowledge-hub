import type { Preferences, Source, SourcesUserFile, TopicsFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeConfigCommand } from "../src/commands/config.js";
import { prefilter } from "../src/prefilter/prefilter.js";
import { categoryHint } from "../src/sources/hint.js";
import { loadSources, loadUserSources, mergeUserSources } from "../src/sources/registry.js";
import { NOW as FETCH_NOW, fakeFetch, makeDeps, makeItem, makeSource } from "./fetch-helpers.js";
import { git } from "./git-testRepo.js";
import { realPreferences } from "./score-factories.js";
import {
  type ConfigRepo,
  configRepo,
  datedEntries,
  rssFeed,
  SEED_SOURCES,
} from "./topics-helpers.js";

const NOW = new Date("2026-10-07T06:00:00Z");
const TECH = "consumer_tech_releases" as const;

let repo: ConfigRepo;
let out: string[];

const html = (head: string): string =>
  `<!doctype html><html><head>${head}</head><body>hi</body></html>`;

/** A site that advertises a feed, and the feed itself. */
function siteRoutes(host: string) {
  return {
    [`https://${host}/feed.xml`]: rssFeed(host, datedEntries(host, 6, NOW)),
    [`https://${host}/`]: html(
      '<link rel="alternate" type="application/rss+xml" href="/feed.xml">',
    ),
  };
}

function command(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const fake = fakeFetch(routes);
  return { run: makeConfigCommand({ http: makeDeps(fake).http }), fake };
}

async function apply(op: unknown, routes: Parameters<typeof fakeFetch>[0] = {}) {
  const { run } = command(routes);
  out.length = 0;
  const code = await run(["apply", "--op", JSON.stringify(op)], repo.context());
  return { code, report: out.length > 0 ? JSON.parse(out.join("")) : undefined };
}

beforeEach(async () => {
  repo = await configRepo(NOW);
  out = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await repo.cleanup();
});

const QUANTUM = {
  op: "topic.upsert",
  topic: {
    name: "Quantum computing",
    description: "Hardware, algorithms and error correction.",
    keywords: ["qubit", "error correction"],
  },
};

describe("topic.upsert", () => {
  it("creates a custom topic with its own section and two queries tagged with its id", async () => {
    const { code, report } = await apply(QUANTUM);
    expect(code).toBe(0);
    expect(report).toMatchObject({
      ok: true,
      op: "topic.upsert",
      topic_id: "quantum_computing",
      new_topic: true,
      commit_message: "chore(config): add topic Quantum computing",
    });
    expect(report.files.sort()).toEqual(["config/queries.json", "config/topics.json"]);

    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    const topic = topics.topics.find((t) => t.id === "quantum_computing");
    expect(topic).toEqual({
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
    });
    expect(topics.sections.at(-1)).toEqual({
      id: "quantum_computing",
      title: "Quantum computing",
      order: 9,
    });
    // The built-in topics are all still there, materialized from the preferences.
    expect(topics.topics.filter((t) => t.origin === "builtin")).toHaveLength(11);

    const queries = await repo.readJson<{
      queries: { id: string; query: string; topic_id?: string }[];
    }>("config/queries.json");
    expect(queries.queries).toHaveLength(2);
    expect(queries.queries.every((q) => q.topic_id === "quantum_computing")).toBe(true);
    expect(queries.queries[0]?.query).toBe("Quantum computing qubit error correction");
    expect(queries.queries.map((q) => q.id)).toEqual([
      "quantum-computing-latest",
      "quantum-computing-analysis",
    ]);
    // Only the files the config command may write are dirty.
    expect(repo.dirty().sort()).toEqual(["config/queries.json", "config/topics.json"]);
  });

  it("changes nothing when the same op arrives twice", async () => {
    await apply(QUANTUM);
    const { code, report } = await apply(QUANTUM);
    expect(code).toBe(0);
    expect(report.files).toEqual([]);
    expect(report.new_topic).toBe(false);
  });

  it("rewrites the queries when the wording changes, and only then", async () => {
    await apply(QUANTUM);
    const edited = {
      op: "topic.upsert",
      topic: { ...QUANTUM.topic, description: "Photonic and superconducting machines." },
    };
    const { report } = await apply(edited);
    expect(report.summary).toBe("update topic Quantum computing");
    const queries = await repo.readJson<{ queries: { query: string }[] }>("config/queries.json");
    expect(queries.queries).toHaveLength(2);
    expect(queries.queries[1]?.query).toBe("Photonic and superconducting machines.");

    const reweighted = { op: "topic.upsert", topic: { ...edited.topic, weight: 0.9 } };
    const before = await repo.read("config/queries.json");
    await apply(reweighted);
    expect(await repo.read("config/queries.json")).toBe(before);
  });

  it("renames a custom topic's own section with it, and leaves a section titled apart alone", async () => {
    await apply(QUANTUM);
    const renamed = {
      op: "topic.upsert",
      topic: { ...QUANTUM.topic, id: "quantum_computing", name: "Quantum machines" },
    };
    expect((await apply(renamed)).code).toBe(0);
    let topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.topics.find((t) => t.id === "quantum_computing")?.name).toBe("Quantum machines");
    expect(topics.sections.find((s) => s.id === "quantum_computing")?.title).toBe(
      "Quantum machines",
    );

    // Filed in a section with a title of its own, the topic's rename leaves that title as it is.
    const shared = { op: "topic.upsert", topic: { ...renamed.topic, section_id: "ai" } };
    expect((await apply(shared)).code).toBe(0);
    const aiTitle = (await repo.readJson<TopicsFile>("config/topics.json")).sections.find(
      (s) => s.id === "ai",
    )?.title;
    expect(
      (await apply({ op: "topic.upsert", topic: { ...shared.topic, name: "Qubits" } })).code,
    ).toBe(0);
    topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.sections.find((s) => s.id === "ai")?.title).toBe(aiTitle);
  });

  it("files a topic in an existing section when asked, and refuses the engine's own sections", async () => {
    const shared = await apply({
      op: "topic.upsert",
      topic: { ...QUANTUM.topic, section_id: "ai" },
    });
    expect(shared.code).toBe(0);
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.sections.some((s) => s.id === "quantum_computing")).toBe(false);
    expect(topics.topics.find((t) => t.id === "quantum_computing")?.section_id).toBe("ai");

    for (const section_id of ["top", "watch"]) {
      const refused = await apply({
        op: "topic.upsert",
        topic: { name: "Other", description: "Other things.", section_id },
      });
      expect(refused.code).toBe(1);
    }
  });

  it("sets name, weight and keywords on a built-in topic, and writes the weight to the preferences", async () => {
    const { code, report } = await apply({
      op: "topic.upsert",
      topic: {
        id: "design_engineering_craft",
        name: "UI craft",
        description: "Changed by mistake.",
        weight: 0.5,
        keywords: ["springs"],
        never_publish: true,
        section_id: "ai",
      },
    });
    expect(code).toBe(0);
    expect(report.summary).toBe("rename topic Design engineering craft to UI craft");
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    const builtin = topics.topics.find((t) => t.id === "design_engineering_craft");
    expect(builtin).toMatchObject({
      name: "UI craft",
      description:
        "How an interface detail was built: implementation technique, craft process or a worked teardown of a polished UI.",
      weight: 0.5,
      keywords: ["springs"],
      never_publish: false,
      section_id: "ui-craft",
    });
    const prefs = await repo.readJson<Preferences>("config/preferences.json");
    expect(prefs.weights.design_engineering_craft).toBe(0.5);
    expect(repo.dirty().sort()).toEqual(["config/preferences.json", "config/topics.json"]);
  });

  it("rewords a topic that ships with the app and keeps its section and depth", async () => {
    const { code, report } = await apply({
      op: "topic.upsert",
      topic: {
        id: "design",
        name: "Product design",
        description: "Interface and product design for a designer.",
        weight: 0.85,
        keywords: [],
        section_id: "ai",
      },
    });
    expect(code).toBe(0);
    expect(report.summary).toBe("update topic Product design");
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.topics.find((t) => t.id === "design")).toMatchObject({
      name: "Product design",
      description: "Interface and product design for a designer.",
      section_id: "design",
      origin: "app",
      depth: "fit_only",
    });
  });
});

describe("topic.upsert on a general news topic", () => {
  it("rewords World, which stays general and always on, and cannot be removed", async () => {
    const { code, report } = await apply({
      op: "topic.upsert",
      topic: {
        id: "world",
        name: "World news",
        description: "International news.",
        weight: 1,
        keywords: [],
        enabled: false,
      },
    });
    expect(code).toBe(0);
    expect(report.summary).toBe("update topic World news");
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.topics.find((t) => t.id === "world")).toMatchObject({
      name: "World news",
      description: "International news.",
      enabled: true,
      origin: "general",
      section_id: "general",
      depth: "coverage",
    });
    const removed = await apply({ op: "topic.remove", id: "world" });
    expect(removed.code).toBe(1);
    expect(repo.errors.join("\n")).toContain("cannot be removed");
  });
});

describe("weights.set", () => {
  it("sets built-in weights in the preferences and custom weights in the topics", async () => {
    await apply(QUANTUM);
    const { code, report } = await apply({
      op: "weights.set",
      weights: { quantum_computing: 0.3, taste_and_design_philosophy: 0.4 },
    });
    expect(code).toBe(0);
    expect(report.summary).toBe("set 2 topic weights");
    const prefs = await repo.readJson<Preferences>("config/preferences.json");
    expect(prefs.weights.taste_and_design_philosophy).toBe(0.4);
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.topics.find((t) => t.id === "quantum_computing")?.weight).toBe(0.3);
    expect(topics.topics.find((t) => t.id === "taste_and_design_philosophy")?.weight).toBe(0.4);
  });
});

describe("topic.scope", () => {
  type Lists = {
    skip_topics: string[];
    weekly: { skip_topics: string[] };
    custom: { skip_topics: string[] };
  };
  const lists = async () => {
    const file = await repo.readJson<Lists>("config/schedule.json");
    return [file.skip_topics, file.weekly.skip_topics, file.custom.skip_topics];
  };

  it("puts topics in and out of each podcast in place, leaving the scopes it does not name", async () => {
    const craft = ["design_engineering_craft", "hci_empirical_research"];
    // The first scope edit writes the general topics into the daily and weekly lists, which a file
    // from before they could play reads as skipping them.
    const general = ["world", "business", "science", "culture", "sports"];
    let result = await apply({ op: "topic.scope", ids: craft, daily: false, custom: false });
    expect(result.code).toBe(0);
    expect(result.report.summary).toBe("set where Design engineering craft plays");
    expect(await lists()).toEqual([[...general, ...craft], general, craft]);
    // Another page built before that change adds its own topic without undoing the first.
    result = await apply({ op: "topic.scope", ids: ["frontier_model_releases"], daily: false });
    expect(await lists()).toEqual([
      [...general, ...craft, "frontier_model_releases"],
      general,
      craft,
    ]);
    result = await apply({ op: "topic.scope", ids: craft, daily: true, weekly: false });
    expect(await lists()).toEqual([
      [...general, "frontier_model_releases"],
      [...general, ...craft],
      craft,
    ]);
  });
});

describe("schedule.set", () => {
  const SET = { op: "schedule.set", hour: 9, cadence_days: 3 };

  it("writes config/schedule.json and nothing else", async () => {
    const { code, report } = await apply(SET);
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/schedule.json"]);
    expect(report.summary).toBe("set the briefing to 09:00, every 3 days");
    expect(await repo.readJson("config/schedule.json")).toEqual({
      version: 1,
      timezone: "Europe/Stockholm",
      hour: 9,
      cadence_days: 3,
      skip_topics: [],
      format: "readout",
      length_minutes: 10,
      voice_id: null,
      voice_id_b: null,
      weekly: {
        enabled: true,
        day: 0,
        hour: 7,
        skip_topics: [],
        format: "readout",
        length_minutes: 10,
        voice_id: null,
        voice_id_b: null,
      },
      custom: {
        skip_topics: [],
        format: "readout",
        length_minutes: 5,
        voice_id: null,
        voice_id_b: null,
      },
    });
  });

  it("saves any subset in one write: voices, the weekly podcast and the Create defaults", async () => {
    const { code, report } = await apply({
      op: "schedule.set",
      voice_id: "ada_1",
      weekly: { enabled: false, day: 5, hour: 18, format: "discussion", voice_id_b: "leo_1" },
      custom: { length_minutes: 15 },
    });
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/schedule.json"]);
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      hour: 7,
      cadence_days: 2,
      voice_id: "ada_1",
      weekly: { enabled: false, day: 5, hour: 18, format: "discussion", voice_id_b: "leo_1" },
      custom: { length_minutes: 15, format: "readout" },
    });
    await apply({ op: "schedule.set", weekly: { day: 2 } });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      weekly: { enabled: false, day: 2, hour: 18 },
      voice_id: "ada_1",
    });
  });

  // The file was written without its zone, so a saved zone was lost at the next edit.
  it("saves the time zone and keeps it when a later edit leaves it out", async () => {
    await apply({ op: "schedule.set", timezone: "America/New_York" });
    await apply(SET);
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      timezone: "America/New_York",
      hour: 9,
    });
  });

  it("saves the podcast format and length, and keeps them when a later edit leaves them out", async () => {
    await apply({ ...SET, format: "headlines", length_minutes: 5 });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      format: "headlines",
      length_minutes: 5,
    });
    await apply({ ...SET, hour: 10 });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      hour: 10,
      format: "headlines",
      length_minutes: 5,
    });
  });

  it("does not create the file when the values are the defaults", async () => {
    const { code, report } = await apply({ ...SET, hour: 7, cadence_days: 2 });
    expect(code).toBe(0);
    expect(report.files).toEqual([]);
    expect(repo.dirty()).toEqual([]);
  });

  it("stores the topics each podcast leaves out, each once", async () => {
    await apply({ ...SET, skip_topics: ["trending", "trending"] });
    await apply({ op: "schedule.set", weekly: { skip_topics: ["design_engineering_craft"] } });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      skip_topics: ["trending"],
      weekly: { skip_topics: ["design_engineering_craft"] },
    });
    await apply({ op: "schedule.set", weekly: { day: 3 } });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      weekly: { day: 3, skip_topics: ["design_engineering_craft"] },
    });
    await apply({ op: "schedule.set", skip_topics: [] });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({ skip_topics: [] });
  });

  it("accepts a topic created earlier in the same batch, and forgets it when it is removed", async () => {
    const { run } = command();
    const code = await run(
      ["apply", "--op", JSON.stringify([QUANTUM, { ...SET, skip_topics: ["quantum_computing"] }])],
      repo.context(),
    );
    expect(code).toBe(0);
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      skip_topics: ["quantum_computing"],
    });
    await apply({ op: "topic.remove", id: "quantum_computing" });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({ skip_topics: [] });
  });
});

describe("profile.block and profile.unblock", () => {
  const FILE = "config/profiles/owner.json";

  it("stores the normalised domain once and removes it again", async () => {
    const first = await apply({ op: "profile.block", domain: "https://WWW.Medium.com:443/@a?x=1" });
    expect(first.code).toBe(0);
    expect(first.report.files).toEqual([FILE]);
    expect(await repo.readJson(FILE)).toEqual({
      user_id: "owner",
      blocked_domains: ["medium.com"],
      votes: [],
    });
    expect((await apply({ op: "profile.block", domain: "medium.com" })).code).toBe(1);

    const gone = await apply({ op: "profile.unblock", domain: "Medium.com" });
    expect(gone.code).toBe(0);
    expect(await repo.readJson(FILE)).toMatchObject({ blocked_domains: [] });
    expect((await apply({ op: "profile.unblock", domain: "medium.com" })).code).toBe(1);
  });

  it("refuses what is not a domain name", async () => {
    for (const domain of ["", "   ", "localhost", "not a domain.com", "a..b.com", "-x.com"]) {
      expect((await apply({ op: "profile.block", domain })).code, domain).toBe(1);
    }
    expect(repo.dirty()).toEqual([]);
  });
});

describe("profile.vote", () => {
  const FILE = "config/profiles/owner.json";
  const vote = (n: number, value: "up" | "down" | "clear", at = "2026-10-07T05:00:00Z") => ({
    story_id: `s${n}`,
    url: `https://WWW.News.Example/p/${n}?utm=1`,
    headline: `  Story ${n}  `,
    topic: "design",
    source_id: "alpha",
    value,
    at,
  });
  const votesOf = async () =>
    (await repo.readJson<{ votes: Array<{ story_id: string; value: string }> }>(FILE)).votes;

  it("keeps one vote per story, drops cleared ones and keeps the newest 500", async () => {
    const first = await apply({ op: "profile.vote", votes: [vote(1, "up"), vote(2, "down")] });
    expect(first.code).toBe(0);
    expect(await votesOf()).toMatchObject([
      { story_id: "s1", value: "up", domain: "news.example", headline: "Story 1" },
      { story_id: "s2", value: "down" },
    ]);
    await apply({ op: "profile.vote", votes: [vote(1, "down", "2026-10-08T05:00:00Z")] });
    await apply({ op: "profile.vote", votes: [vote(2, "clear")] });
    expect(await votesOf()).toMatchObject([{ story_id: "s1", value: "down" }]);

    for (let batch = 0; batch < 10; batch++) {
      const votes = Array.from({ length: 50 }, (_, i) =>
        vote(100 + batch * 50 + i, "up", "2026-11-01T00:00:00Z"),
      );
      expect((await apply({ op: "profile.vote", votes })).code).toBe(0);
    }
    const stored = await votesOf();
    expect(stored).toHaveLength(500);
    expect(stored.map((v) => v.story_id)).not.toContain("s1");
  }, 60_000);

  it("refuses the whole op when one vote is malformed", async () => {
    const bad = { ...vote(3, "up"), url: "ftp://x.example/a" };
    expect((await apply({ op: "profile.vote", votes: [vote(2, "up"), bad] })).code).toBe(1);
    expect((await apply({ op: "profile.vote", votes: [] })).code).toBe(1);
    expect(repo.dirty()).toEqual([]);
  });
});

describe("writer.set", () => {
  const SET = { op: "writer.set", provider: "nebius", model: "meta-llama/Llama-3.3-70B-Instruct" };

  it("writes config/writer.json and nothing else", async () => {
    const { code, report } = await apply(SET);
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/writer.json"]);
    expect(report.summary).toBe("set the writer to meta-llama/Llama-3.3-70B-Instruct");
    expect(await repo.readJson("config/writer.json")).toEqual({
      version: 1,
      provider: "nebius",
      model: "meta-llama/Llama-3.3-70B-Instruct",
    });
  });

  it("does not create the file for the default writer", async () => {
    const { code, report } = await apply({
      op: "writer.set",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(code).toBe(0);
    expect(report.files).toEqual([]);
    expect(repo.dirty()).toEqual([]);
  });

  it("returns to automatic after a pick", async () => {
    await apply(SET);
    const { report } = await apply({ ...SET, model: null });
    expect(report.summary).toBe("set the writer to automatic");
    expect(await repo.readJson("config/writer.json")).toMatchObject({ model: null });
  });

  it("writes an Anthropic pick and refuses a Claude id on Nebius or a malformed one on Anthropic", async () => {
    const { code, report } = await apply({
      op: "writer.set",
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    expect(code).toBe(0);
    expect(await repo.readJson("config/writer.json")).toEqual({
      version: 1,
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    expect(report.summary).toBe("set the writer to claude-haiku-5-5");
    for (const bad of [
      { ...SET, model: "claude-haiku-5-5" },
      { ...SET, provider: "anthropic", model: "claude opus" },
      { ...SET, provider: "anthropic", model: null },
    ]) {
      expect((await apply(bad)).code, JSON.stringify(bad)).toBe(1);
    }
  });

  it("a broken config/writer.json does not block an edit to something else", async () => {
    await writeFileIn("config/writer.json", "{ not json");
    const { code, report } = await apply({
      op: "schedule.set",
      hour: 9,
      cadence_days: 3,
    });
    expect(code).toBe(0);
    // The schedule is saved, and the broken file is left for the next pick of a model to replace.
    expect(report.files).toEqual(["config/schedule.json"]);
  });

  it("picking a model replaces a broken config/writer.json", async () => {
    await writeFileIn("config/writer.json", '{ "version": 1, "provider": "someone-else" }');
    const { code, report } = await apply(SET);
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/writer.json"]);
    expect(await repo.readJson("config/writer.json")).toEqual({
      version: 1,
      provider: "nebius",
      model: "meta-llama/Llama-3.3-70B-Instruct",
    });
  });
});

describe("topic.remove", () => {
  it("removes a custom topic with its section, queries, auto sources and candidates", async () => {
    await apply(QUANTUM);
    // An automatic source for the topic, a pinned one, and one shared with another topic.
    const user: SourcesUserFile = {
      version: 1,
      added: [
        source("auto-only", { origin: "auto", topic_ids: ["quantum_computing"] }),
        source("auto-pinned", { origin: "auto", topic_ids: ["quantum_computing"], pinned: true }),
        source("manual", { origin: "manual", topic_ids: ["quantum_computing"] }),
        source("shared", { origin: "auto", topic_ids: ["quantum_computing", "other"] }),
      ],
      overrides: { "auto-only": { pinned: false } },
    };
    await writeFileIn("config/sources.user.json", JSON.stringify(user));
    await writeFileIn(
      "state/source-candidates.json",
      JSON.stringify({
        version: 1,
        topics: {
          quantum_computing: { suggested_at: NOW.toISOString(), queries: [], candidates: [] },
          other: { suggested_at: NOW.toISOString(), queries: [], candidates: [] },
        },
      }),
    );

    const { code } = await apply({ op: "topic.remove", id: "quantum_computing" });
    expect(code).toBe(0);
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    expect(topics.topics.some((t) => t.id === "quantum_computing")).toBe(false);
    expect(topics.sections.some((s) => s.id === "quantum_computing")).toBe(false);
    const queries = await repo.readJson<{ queries: unknown[] }>("config/queries.json");
    expect(queries.queries).toEqual([]);
    const after = await repo.readJson<SourcesUserFile>("config/sources.user.json");
    expect(after.added.map((s) => s.id)).toEqual(["auto-pinned", "manual", "shared"]);
    expect(after.added.find((s) => s.id === "shared")?.topic_ids).toEqual(["other"]);
    expect(after.added.find((s) => s.id === "manual")?.topic_ids).toBeUndefined();
    expect(after.overrides).toEqual({});
    const candidates = await repo.readJson<{ topics: Record<string, unknown> }>(
      "state/source-candidates.json",
    );
    expect(Object.keys(candidates.topics)).toEqual(["other"]);
  });
});

function source(id: string, extra: Partial<Source> = {}): Source {
  return makeSource({
    id,
    url: `https://${id}.example/`,
    feed_url: `https://${id}.example/feed.xml`,
    ...extra,
  });
}

async function writeFileIn(rel: string, text: string): Promise<void> {
  const { put, commitAll } = await import("./git-testRepo.js");
  await put(repo.root, rel, `${text}\n`);
  await commitAll(repo.root, `chore: seed ${rel}`);
}

describe("source ops", () => {
  it("adds a source by URL, discovering its feed, and tags it with a topic", async () => {
    await apply(QUANTUM);
    const { code, report } = await apply(
      { op: "source.add", url: "https://new.example/", topic_ids: ["quantum_computing"] },
      siteRoutes("new.example"),
    );
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/sources.user.json"]);
    const user = await repo.readJson<SourcesUserFile>("config/sources.user.json");
    expect(user.added).toEqual([
      {
        id: "new-example",
        name: "new.example",
        type: "rss",
        url: "https://new.example/",
        feed_url: "https://new.example/feed.xml",
        tier: "daily",
        high_signal: false,
        enabled: true,
        failures: 0,
        options: {},
        origin: "manual",
        topic_ids: ["quantum_computing"],
      },
    ]);
    // The seed file is untouched: edits live in the user file.
    expect(repo.dirty()).not.toContain("config/sources.json");
    expect((await loadSources(repo.root)).sources.map((s) => s.id)).toEqual([
      "alpha",
      "beta",
      "new-example",
    ]);
  });

  it("adds a page with no feed as a scrape source, and a GitHub repository as a release feed", async () => {
    const scrape = await apply(
      { op: "source.add", url: "https://plain.example/news" },
      { "https://plain.example/": html("<title>no feed</title>") },
    );
    expect(scrape.code).toBe(0);
    const gh = await apply({ op: "source.add", url: "https://github.com/acme/widgets/releases" });
    expect(gh.code).toBe(0);
    const user = await loadUserSources(repo.root);
    expect(user.added.map((s) => [s.type, s.feed_url, s.options])).toEqual([
      ["firecrawl", null, {}],
      ["github", "https://github.com/acme/widgets/releases.atom", { repo: "acme/widgets" }],
    ]);
  });

  it("refuses a duplicate, a dead page and an unknown topic, and writes nothing", async () => {
    const duplicate = await apply({ op: "source.add", url: "https://alpha.example/feed.xml" }, {});
    expect(duplicate.code).toBe(1);
    expect(repo.errors.join("\n")).toContain("Already a source: alpha");

    const dead = await apply(
      { op: "source.add", url: "https://gone.example/" },
      { "https://gone.example/": { status: 404 } },
    );
    expect(dead.code).toBe(1);

    const unknown = await apply(
      { op: "source.add", url: "https://new.example/", topic_ids: ["nope"] },
      siteRoutes("new.example"),
    );
    expect(unknown.code).toBe(1);
    expect(repo.dirty()).toEqual([]);
  });

  it("switches and pins seed sources through overrides, leaving sources.json alone", async () => {
    const { code } = await apply({ op: "source.set", id: "alpha", enabled: false, pinned: true });
    expect(code).toBe(0);
    expect(repo.dirty()).toEqual(["config/sources.user.json"]);
    const user = await loadUserSources(repo.root);
    expect(user.overrides).toEqual({ alpha: { enabled: false, pinned: true } });
    const merged = await loadSources(repo.root);
    expect(merged.sources.find((s) => s.id === "alpha")).toMatchObject({
      enabled: false,
      pinned: true,
    });
    expect(merged.sources.find((s) => s.id === "beta")?.enabled).toBe(true);
    expect((await apply({ op: "source.set", id: "ghost", enabled: true })).code).toBe(1);
  });

  it("renames an added source and moves it between topics in place, built-in ones too", async () => {
    await apply(QUANTUM);
    await apply(
      { op: "source.add", url: "https://new.example/", topic_ids: ["quantum_computing"] },
      siteRoutes("new.example"),
    );

    const renamed = await apply({ op: "source.update", id: "new-example", name: " New Weekly " });
    expect(renamed.code).toBe(0);
    expect(renamed.report).toMatchObject({
      op: "source.update",
      summary: "rename source new.example to New Weekly",
      commit_message: "chore(config): rename source new.example to New Weekly",
      files: ["config/sources.user.json"],
    });
    let user = await loadUserSources(repo.root);
    expect(user.added[0]).toMatchObject({
      id: "new-example",
      name: "New Weekly",
      topic_ids: ["quantum_computing"],
    });
    expect(user.overrides).toEqual({});

    const moved = await apply({
      op: "source.update",
      id: "new-example",
      topic_ids: ["design_engineering_craft", "quantum_computing", "design_engineering_craft"],
    });
    expect(moved.report.summary).toBe(
      "move source New Weekly to Design engineering craft and Quantum computing",
    );
    user = await loadUserSources(repo.root);
    expect(user.added[0]?.topic_ids).toEqual(["design_engineering_craft", "quantum_computing"]);

    const cleared = await apply({ op: "source.update", id: "new-example", topic_ids: [] });
    expect(cleared.report.summary).toBe("move source New Weekly to no topic");
    user = await loadUserSources(repo.root);
    expect(user.added[0]).not.toHaveProperty("topic_ids");
    expect(user.overrides).toEqual({});
    expect(repo.dirty()).not.toContain("config/sources.json");
  });

  it("keeps a seed source's new name and topics in its override, which wins when merged", async () => {
    const { code, report } = await apply({
      op: "source.update",
      id: "alpha",
      name: "Alpha Weekly",
      topic_ids: ["design"],
    });
    expect(code).toBe(0);
    expect(report.summary).toBe("rename source Alpha to Alpha Weekly and move it to Design");
    expect(repo.dirty()).toEqual(["config/sources.user.json"]);
    const user = await loadUserSources(repo.root);
    expect(user).toMatchObject({
      added: [],
      overrides: { alpha: { name: "Alpha Weekly", topic_ids: ["design"] } },
    });
    expect((await loadSources(repo.root)).sources.find((s) => s.id === "alpha")).toMatchObject({
      name: "Alpha Weekly",
      topic_ids: ["design"],
    });

    // A built-in topic is a topic like any other, and an empty list leaves the seed source feeding
    // none of its own. What source.set wrote stays.
    await apply({ op: "source.set", id: "alpha", pinned: true });
    expect(
      (await apply({ op: "source.update", id: "alpha", topic_ids: ["consumer_tech_releases"] }))
        .code,
    ).toBe(0);
    expect((await loadUserSources(repo.root)).overrides.alpha?.topic_ids).toEqual([
      "consumer_tech_releases",
    ]);
    await apply({ op: "source.update", id: "alpha", topic_ids: [] });
    expect((await loadUserSources(repo.root)).overrides.alpha).toEqual({
      name: "Alpha Weekly",
      topic_ids: [],
      pinned: true,
    });
    const merged = (await loadSources(repo.root)).sources.find((s) => s.id === "alpha");
    expect(merged).toMatchObject({ name: "Alpha Weekly", pinned: true });
    expect(merged).not.toHaveProperty("topic_ids");
    expect(repo.dirty()).toEqual(["config/sources.user.json"]);
  });

  it("refuses an unknown source or topic, and an update that changes nothing", async () => {
    expect((await apply({ op: "source.update", id: "ghost", name: "Ghost" })).code).toBe(1);
    expect(repo.errors.join("\n")).toContain("There is no source ghost.");
    expect((await apply({ op: "source.update", id: "alpha", topic_ids: ["nope"] })).code).toBe(1);
    expect(repo.errors.join("\n")).toContain("There is no topic nope.");
    expect((await apply({ op: "source.update", id: "alpha" })).code).toBe(1);
    expect(repo.errors.join("\n")).toContain("set name, topic_ids or both");
    expect(repo.dirty()).toEqual([]);
  });

  it("hides a seed source and deletes an added one", async () => {
    await apply({ op: "source.remove", id: "beta" });
    expect((await loadSources(repo.root)).sources.map((s) => s.id)).toEqual(["alpha"]);
    expect((await loadUserSources(repo.root)).overrides.beta).toEqual({ removed: true });

    await apply({ op: "source.add", url: "https://new.example/" }, siteRoutes("new.example"));
    expect((await loadSources(repo.root)).sources.map((s) => s.id)).toContain("new-example");
    await apply({ op: "source.remove", id: "new-example" });
    const user = await loadUserSources(repo.root);
    expect(user.added).toEqual([]);
    expect(user.overrides["new-example"]).toBeUndefined();
  });
});

// Every refused op exits 1 and leaves the tree as it was; one row per op and reason.
describe("refused ops write nothing", () => {
  const SCHEDULE = { op: "schedule.set", hour: 9, cadence_days: 3 };
  const WRITER = {
    op: "writer.set",
    provider: "nebius",
    model: "meta-llama/Llama-3.3-70B-Instruct",
  };
  it.each([
    [
      "topic.upsert with a built-in id as its name",
      { op: "topic.upsert", topic: { name: "None", description: "Nothing at all." } },
    ],
    ["weights.set for an unknown topic", { op: "weights.set", weights: { nope: 0.4 } }],
    ["topic.scope for an unknown topic", { op: "topic.scope", ids: ["nope"], daily: false }],
    ["schedule.set with a bad voice id", { op: "schedule.set", voice_id: "not a voice" }],
    ["schedule.set with a bad weekly day", { op: "schedule.set", weekly: { day: 7 } }],
    [
      "schedule.set with an incomplete custom default",
      { op: "schedule.set", custom: { format: "headlines" } },
    ],
    ["schedule.set skipping an unknown topic", { ...SCHEDULE, skip_topics: ["nope"] }],
    [
      "schedule.set with a weekly skip of an unknown topic",
      { op: "schedule.set", weekly: { skip_topics: ["nope"] } },
    ],
    ["schedule.set with hour 24", { ...SCHEDULE, hour: 24 }],
    ["schedule.set with a cadence of 4", { ...SCHEDULE, cadence_days: 4 }],
    ["schedule.set with an unsupported time zone", { ...SCHEDULE, timezone: "Mars/Olympus" }],
    ["writer.set with a spaced model id", { ...WRITER, model: "has space" }],
    ["writer.set with an empty model id", { ...WRITER, model: "" }],
    ["writer.set with an unknown provider", { ...WRITER, provider: "other" }],
    ["topic.remove of a built-in topic", { op: "topic.remove", id: "design_engineering_craft" }],
    ["topic.remove of an unknown topic", { op: "topic.remove", id: "missing" }],
  ])("refuses %s", async (_name, op) => {
    expect((await apply(op)).code).toBe(1);
    expect(repo.dirty()).toEqual([]);
  });
});

describe("invalid input", () => {
  it("rejects bad JSON and a bad op with a message per problem, and writes nothing", async () => {
    const { run } = command();
    expect(await run(["apply", "--op", "{not json"], repo.context())).toBe(1);
    expect(repo.errors.join("\n")).toContain("not valid JSON");
    repo.errors.length = 0;
    expect(
      await run(
        ["apply", "--op", JSON.stringify({ op: "weights.set", weights: { x: 7 } })],
        repo.context(),
      ),
    ).toBe(1);
    expect(repo.errors.join("\n")).toContain("Invalid op at weights.x");
    expect(repo.dirty()).toEqual([]);
  });

  it("returns 2 for a missing --op or an unknown subcommand", async () => {
    const { run } = command();
    expect(await run(["apply"], repo.context())).toBe(2);
    expect(await run(["frobnicate"], repo.context())).toBe(2);
  });

  it("does not write with --dry-run", async () => {
    const { run } = command();
    expect(await run(["apply", "--dry-run", "--op", JSON.stringify(QUANTUM)], repo.context())).toBe(
      0,
    );
    expect(repo.dirty()).toEqual([]);
    expect(JSON.parse(out.join("")).files).toContain("config/topics.json");
  });
});

describe("config commit", () => {
  it("commits what apply wrote through the guard, with the message apply suggested", async () => {
    const { run } = command();
    await run(["apply", "--op", JSON.stringify(QUANTUM)], repo.context());
    const message = JSON.parse(out.join("")).commit_message as string;
    out.length = 0;
    expect(await run(["commit", "--message", message, "--no-push"], repo.context())).toBe(0);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe(
      "chore(config): add topic Quantum computing",
    );
    expect(git(repo.root, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
      "config/queries.json",
      "config/topics.json",
    ]);
    expect(repo.dirty()).toEqual([]);
  });

  it("refuses to commit when anything outside the allowlist changed, and stages nothing", async () => {
    const { run } = command();
    await run(["apply", "--op", JSON.stringify(QUANTUM)], repo.context());
    const { put } = await import("./git-testRepo.js");
    await put(repo.root, "package.json", '{"name":"tampered"}\n');
    expect(await run(["commit", "--message", "add topic", "--no-push"], repo.context())).toBe(1);
    expect(repo.errors.join("\n")).toContain("package.json");
    expect(git(repo.root, "diff", "--cached", "--name-only")).toBe("");
  });

  it("adds the conventional prefix to a bare message", async () => {
    const { run } = command();
    await run(["apply", "--op", JSON.stringify(QUANTUM)], repo.context());
    expect(await run(["commit", "--message", "add topic", "--no-push"], repo.context())).toBe(0);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(config): add topic");
  });
});

describe("the merged registry", () => {
  it("lets a seed id win a clash and ignores an override for a source that is gone", () => {
    const base = { version: 1 as const, sources: [source("a"), source("b")] };
    const merged = mergeUserSources(base, {
      version: 1,
      added: [source("a", { name: "Imposter" }), source("c")],
      overrides: { b: { removed: true }, ghost: { enabled: false } },
    });
    expect(merged.sources.map((s) => s.id)).toEqual(["a", "c"]);
    expect(merged.sources[0]?.name).toBe("a");
  });

  it("lets an override's name and topics win over the source's own, and an empty list clear them", () => {
    const base = {
      version: 1 as const,
      sources: [
        source("a", { name: "A", topic_ids: ["x"] }),
        source("b", { topic_ids: ["y"], category_hint: "developer_tool_launches" }),
        source("c"),
      ],
    };
    const merged = mergeUserSources(base, {
      version: 1,
      added: [source("d", { topic_ids: ["y"] })],
      overrides: {
        a: { name: "Renamed", topic_ids: ["z", "w"] },
        b: { topic_ids: [] },
        c: { enabled: false },
        d: { name: "Dee" },
      },
    });
    expect(merged.sources.map((s) => [s.id, s.name, s.topic_ids])).toEqual([
      ["a", "Renamed", ["z", "w"]],
      ["b", "b", undefined],
      ["c", "c", undefined],
      ["d", "Dee", ["y"]],
    ]);
    expect(merged.sources[1]).not.toHaveProperty("topic_ids");
    expect(merged.sources[2]?.enabled).toBe(false);
    expect(base.sources[0]).toMatchObject({ name: "A", topic_ids: ["x"] });
  });

  it("lets an override that sets the topics decide the category hint, and no other", () => {
    const base = {
      version: 1 as const,
      sources: [
        source("custom", { category_hint: TECH }),
        source("other", { category_hint: TECH, topic_ids: ["trending"] }),
        source("builtin", { category_hint: "developer_tool_launches" }),
        source("app", { category_hint: TECH }),
        source("renamed", { category_hint: TECH }),
        source("untouched", { category_hint: TECH }),
      ],
    };
    const merged = mergeUserSources(base, {
      version: 1,
      added: [],
      overrides: {
        custom: { topic_ids: ["quantum_computing"] },
        other: { topic_ids: [] },
        builtin: {
          topic_ids: ["quantum_computing", "design_engineering_craft", "frontier_model_releases"],
        },
        app: { topic_ids: ["design"] },
        renamed: { name: "Renamed", pinned: true },
      },
    });
    const byId = Object.fromEntries(merged.sources.map((s) => [s.id, s]));
    // The first built-in category the override names; none for custom or app topics, or for Other.
    expect(byId.custom).not.toHaveProperty("category_hint");
    expect(byId.other).not.toHaveProperty("category_hint");
    expect(byId.other).not.toHaveProperty("topic_ids");
    expect(byId.builtin?.category_hint).toBe("design_engineering_craft");
    expect(byId.app).not.toHaveProperty("category_hint");
    expect(byId.app?.topic_ids).toEqual(["design"]);
    // An override that leaves the topics alone leaves the hint alone.
    expect(byId.renamed?.category_hint).toBe(TECH);
    expect(byId.untouched?.category_hint).toBe(TECH);
  });

  it("steers a moved source's items where it was moved, in the prefilter and dedupe", () => {
    const base = {
      version: 1 as const,
      sources: [
        source("phones", { category_hint: TECH }),
        source("tablets", { category_hint: TECH }),
      ],
    };
    const merged = mergeUserSources(base, {
      version: 1,
      added: [],
      overrides: { phones: { topic_ids: [] } },
    });
    const launch = (sourceId: string) =>
      makeItem({
        url: `https://${sourceId}.example/launch`,
        title: "Acme Phone goes on sale",
        source_id: sourceId,
      });
    const run = (sources: Source[]) =>
      prefilter({
        items: [launch("phones"), launch("tablets")],
        preferences: realPreferences(),
        sources,
        now: FETCH_NOW,
      }).report;
    // Before the move both outlets feed the tech beat; after it only the one still hinted does.
    expect(run(base.sources).tech.input).toBe(2);
    expect(run(merged.sources).tech.input).toBe(1);
    // Dedupe reads the hint the same way, so it no longer hands the old category on.
    const phones = merged.sources.find((s) => s.id === "phones");
    expect(categoryHint(launch("phones"), phones)).toBeUndefined();
  });
});

describe("source.update and the category hint", () => {
  const hintedSeed = () =>
    writeFileIn(
      "config/sources.json",
      JSON.stringify(
        { version: 1, sources: [{ ...SEED_SOURCES[0], category_hint: TECH }, SEED_SOURCES[1]] },
        null,
        2,
      ),
    );
  const alpha = async () => (await loadSources(repo.root)).sources.find((s) => s.id === "alpha");

  it("moves a seed source's hint with its topics, and keeps sources.json as it was", async () => {
    await hintedSeed();
    expect((await alpha())?.category_hint).toBe(TECH);

    await apply({ op: "source.update", id: "alpha", topic_ids: [] });
    expect(await alpha()).not.toHaveProperty("category_hint");
    await apply({ op: "source.update", id: "alpha", topic_ids: ["developer_tool_launches"] });
    expect(await alpha()).toMatchObject({
      category_hint: "developer_tool_launches",
      topic_ids: ["developer_tool_launches"],
    });
    await apply({ op: "source.update", id: "alpha", name: "Alpha Weekly" });
    expect((await alpha())?.category_hint).toBe("developer_tool_launches");
    expect(repo.dirty()).toEqual(["config/sources.user.json"]);
  });

  it("takes a removed topic out of seed overrides, returning a source to its own hint", async () => {
    await hintedSeed();
    await apply(QUANTUM);
    await apply({ op: "source.update", id: "alpha", topic_ids: ["quantum_computing"] });
    await apply({
      op: "source.update",
      id: "beta",
      name: "Beta Weekly",
      topic_ids: ["quantum_computing", "design"],
    });
    expect(await alpha()).not.toHaveProperty("category_hint");

    expect((await apply({ op: "topic.remove", id: "quantum_computing" })).code).toBe(0);
    const user = await loadUserSources(repo.root);
    expect(user.overrides.alpha).toBeUndefined();
    expect(user.overrides.beta).toEqual({ name: "Beta Weekly", topic_ids: ["design"] });
    expect(await alpha()).toMatchObject({ category_hint: TECH });
    expect(await alpha()).not.toHaveProperty("topic_ids");
  });
});
