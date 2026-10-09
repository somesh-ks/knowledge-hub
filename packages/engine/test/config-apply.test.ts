import type { Preferences, Source, SourcesUserFile, TopicsFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeConfigCommand } from "../src/commands/config.js";
import { loadSources, loadUserSources, mergeUserSources } from "../src/sources/registry.js";
import { fakeFetch, makeDeps, makeSource } from "./fetch-helpers.js";
import { git } from "./git-testRepo.js";
import { type ConfigRepo, configRepo, datedEntries, rssFeed } from "./topics-helpers.js";

const NOW = new Date("2026-10-07T06:00:00Z");

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

  it("refuses a name that is a built-in id", async () => {
    const refused = await apply({
      op: "topic.upsert",
      topic: { name: "None", description: "Nothing at all." },
    });
    expect(refused.code).toBe(1);
    expect(repo.errors.join("\n")).toContain("reserved");
  });

  it("sets only weight and keywords on a built-in topic, and writes the weight to the preferences", async () => {
    const { code } = await apply({
      op: "topic.upsert",
      topic: {
        id: "design_engineering_craft",
        name: "Renamed by mistake",
        description: "Changed by mistake.",
        weight: 0.5,
        keywords: ["springs"],
        never_publish: true,
        section_id: "ai",
      },
    });
    expect(code).toBe(0);
    const topics = await repo.readJson<TopicsFile>("config/topics.json");
    const builtin = topics.topics.find((t) => t.id === "design_engineering_craft");
    expect(builtin).toMatchObject({
      name: "Design engineering craft",
      weight: 0.5,
      keywords: ["springs"],
      never_publish: false,
      section_id: "ui-craft",
    });
    const prefs = await repo.readJson<Preferences>("config/preferences.json");
    expect(prefs.weights.design_engineering_craft).toBe(0.5);
    expect(repo.dirty().sort()).toEqual(["config/preferences.json", "config/topics.json"]);
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

  it("refuses an unknown topic and writes nothing", async () => {
    const { code } = await apply({ op: "weights.set", weights: { nope: 0.4 } });
    expect(code).toBe(1);
    expect(repo.dirty()).toEqual([]);
  });
});

describe("schedule.set", () => {
  const SET = { op: "schedule.set", hour: 9, cadence_days: 3, sections: null };

  it("writes config/schedule.json and nothing else", async () => {
    const { code, report } = await apply(SET);
    expect(code).toBe(0);
    expect(report.files).toEqual(["config/schedule.json"]);
    expect(report.summary).toBe("set the briefing to 09:00, every 3 days");
    expect(await repo.readJson("config/schedule.json")).toEqual({
      version: 1,
      hour: 9,
      cadence_days: 3,
      sections: null,
      format: "readout",
      length_minutes: 10,
      voice_id: null,
      voice_id_b: null,
      weekly: {
        enabled: true,
        day: 0,
        hour: 7,
        format: "readout",
        length_minutes: 10,
        voice_id: null,
        voice_id_b: null,
      },
      custom: { format: "readout", length_minutes: 5, voice_id: null, voice_id_b: null },
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

  it("refuses a bad voice id or weekly day and writes nothing", async () => {
    for (const bad of [
      { op: "schedule.set", voice_id: "not a voice" },
      { op: "schedule.set", weekly: { day: 7 } },
      { op: "schedule.set", custom: { format: "headlines" } },
    ]) {
      expect((await apply(bad)).code, JSON.stringify(bad)).toBe(1);
    }
    expect(repo.dirty()).toEqual([]);
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

  it("stores a list of sections without Top picks", async () => {
    await apply({ ...SET, sections: ["ai", "top", "ai"] });
    expect(await repo.readJson("config/schedule.json")).toMatchObject({ sections: ["ai"] });
  });

  it("refuses an unknown section, an empty list and a bad hour, and writes nothing", async () => {
    for (const bad of [
      { ...SET, sections: ["nope"] },
      { ...SET, sections: ["top"] },
      { ...SET, sections: [] },
      { ...SET, hour: 24 },
      { ...SET, cadence_days: 4 },
    ]) {
      const { code } = await apply(bad);
      expect(code, JSON.stringify(bad)).toBe(1);
    }
    expect(repo.dirty()).toEqual([]);
  });

  it("accepts a section a topic created earlier in the same batch", async () => {
    const { run } = command();
    const code = await run(
      ["apply", "--op", JSON.stringify([QUANTUM, { ...SET, sections: ["quantum_computing"] }])],
      repo.context(),
    );
    expect(code).toBe(0);
    expect(await repo.readJson("config/schedule.json")).toMatchObject({
      sections: ["quantum_computing"],
    });
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

  it("does not create the file for the automatic default", async () => {
    const { code, report } = await apply({ ...SET, model: null });
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

  it("refuses an odd id and an unknown provider, and writes nothing", async () => {
    for (const bad of [
      { ...SET, model: "has space" },
      { ...SET, model: "" },
      { ...SET, provider: "other" },
    ]) {
      const { code } = await apply(bad);
      expect(code, JSON.stringify(bad)).toBe(1);
    }
    expect(repo.dirty()).toEqual([]);
  });

  it("writes an Anthropic pick and refuses a Claude id on Nebius or a free one on Anthropic", async () => {
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
      { ...SET, provider: "anthropic", model: "claude-opus-9" },
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
      sections: null,
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

  it("refuses a built-in topic and an unknown one", async () => {
    expect((await apply({ op: "topic.remove", id: "design_engineering_craft" })).code).toBe(1);
    expect((await apply({ op: "topic.remove", id: "missing" })).code).toBe(1);
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
});
