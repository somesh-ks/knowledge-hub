import { CATEGORIES } from "@singularity/core";
import type { SqlClient } from "@singularity/engine/config-store";
import { describe, expect, it } from "vitest";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import type { ConfigOp } from "../types/contracts";
import {
  CONFIG_COOLDOWN_MS,
  type ConfigDeps,
  configCooldownSeconds,
  handleConfig,
  MAX_CONFIG_BODY_CHARS,
  MAX_OPS,
  parseConfigOp,
  parseConfigRequest,
} from "./configEdit";
import { type ConfigReadBody, handleConfigRead } from "./configStore";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const RUNS = "GET /actions/workflows/config.yml/runs";
const DISPATCH = "POST /actions/workflows/config.yml/dispatches";
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function setup(overrides: Partial<ConfigDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: ConfigDeps = {
    env: {
      GITHUB_SINGULARITY_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
    },
    fetch: github.fetch,
    now: () => NOW,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { github, deps, delays, logs };
}

const topic = {
  id: "motion-craft",
  name: "Motion craft",
  description: "Springs, easing and the feel of interfaces in motion.",
  enabled: true,
  keywords: ["spring", "easing"],
  section_id: "ui-craft",
};
const upsert: ConfigOp = { op: "topic.upsert", topic };

const body = (op: unknown) => JSON.stringify({ op });
const input = (bodyText: string, origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});

describe("parseConfigOp", () => {
  it("accepts each operation in the contract", () => {
    const ops: ConfigOp[] = [
      upsert,
      { op: "topic.remove", id: "motion-craft" },
      { op: "source.add", url: "https://example.com/feed.xml" },
      { op: "source.add", url: "https://example.com/", topic_ids: ["motion-craft"] },
      // The page names the id, so an edit before the next run finds the source ("There is no
      // source x" when the parser dropped it), and the format the person chose.
      { op: "source.add", url: "https://example.com/", id: "example-com", format: "video" },
      { op: "source.set", id: "openai-blog", enabled: false },
      { op: "source.set", id: "openai-blog", pinned: true },
      { op: "source.remove", id: "openai-blog" },
    ];
    for (const op of ops) expect(parseConfigOp(op)).toEqual(op);
  });

  it("rebuilds the edit, so a field the contract does not name never passes", () => {
    const parsed = parseConfigOp({
      op: "topic.upsert",
      topic: { ...topic, origin: "builtin", never_publish: true },
      extra: "x",
    });
    expect(parsed).toEqual(upsert);
    expect(parseConfigOp({ op: "source.remove", id: "openai-blog", force: true })).toEqual({
      op: "source.remove",
      id: "openai-blog",
    });
  });

  it("carries a topic's emoji through, and rejects one that is empty or too long", () => {
    const parsed = parseConfigOp({ op: "topic.upsert", topic: { ...topic, emoji: " 🎞️ " } });
    expect(parsed).toMatchObject({ topic: { emoji: "🎞️" } });
    for (const emoji of ["", "x".repeat(17), 7]) {
      expect(parseConfigOp({ op: "topic.upsert", topic: { ...topic, emoji } })).toBeNull();
    }
  });

  it("trims names and descriptions", () => {
    const parsed = parseConfigOp({
      op: "topic.upsert",
      topic: { ...topic, name: "  Motion craft ", description: " Springs. " },
    });
    expect(parsed).toMatchObject({ topic: { name: "Motion craft", description: "Springs." } });
  });

  it("rejects ids outside lowercase letters, digits, hyphen and underscore, 2 to 40 long", () => {
    for (const bad of ["a", "A-b", "has space", "dot.id", "x".repeat(41), "", 7, null]) {
      expect(parseConfigOp({ op: "topic.remove", id: bad })).toBeNull();
    }
    expect(parseConfigOp({ op: "topic.remove", id: "x".repeat(40) })).not.toBeNull();
    expect(parseConfigOp({ op: "topic.remove", id: "ab" })).not.toBeNull();
  });

  it("rejects a topic outside its limits", () => {
    const bad = (change: Record<string, unknown>) =>
      parseConfigOp({ op: "topic.upsert", topic: { ...topic, ...change } });
    expect(bad({ name: "" })).toBeNull();
    expect(bad({ name: "n".repeat(61) })).toBeNull();
    expect(bad({ name: "n".repeat(60) })).not.toBeNull();
    expect(bad({ description: "" })).toBeNull();
    expect(bad({ description: "d".repeat(401) })).toBeNull();
    expect(bad({ description: "d".repeat(400) })).not.toBeNull();
    expect(bad({ keywords: Array.from({ length: 13 }, (_, i) => `k${i}`) })).toBeNull();
    expect(bad({ keywords: Array.from({ length: 12 }, (_, i) => `k${i}`) })).not.toBeNull();
    expect(bad({ keywords: ["k".repeat(41)] })).toBeNull();
    expect(bad({ keywords: [""] })).toBeNull();
    expect(bad({ keywords: "spring" })).toBeNull();
    expect(bad({ enabled: "yes" })).toBeNull();
    expect(bad({ section_id: "Top Picks" })).toBeNull();
  });

  it("rejects control characters, so a line break cannot forge a log line", () => {
    expect(
      parseConfigOp({ op: "topic.upsert", topic: { ...topic, name: "Motion\nforged" } }),
    ).toBeNull();
    expect(parseConfigOp({ op: "source.add", url: "https://example.com/\u0000" })).toBeNull();
  });

  it("accepts only http and https addresses with a host and no credentials", () => {
    const url = (value: unknown) => parseConfigOp({ op: "source.add", url: value });
    expect(url("http://example.com/feed")).not.toBeNull();
    expect(url("https://example.com/feed")).not.toBeNull();
    for (const bad of [
      "ftp://example.com/feed",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "example.com",
      "https://user:pass@example.com/",
      "https://",
      "",
      42,
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(url(bad)).toBeNull();
    }
  });

  it("limits the topics a source is added for", () => {
    const withTopics = (topic_ids: unknown) =>
      parseConfigOp({ op: "source.add", url: "https://example.com/", topic_ids });
    expect(withTopics(["a-b"])).not.toBeNull();
    expect(withTopics(["A"])).toBeNull();
    expect(withTopics("motion-craft")).toBeNull();
    expect(withTopics(Array.from({ length: 13 }, (_, i) => `topic-${i}`))).toBeNull();
  });

  it("needs source.set to change something, and only with booleans", () => {
    expect(parseConfigOp({ op: "source.set", id: "openai-blog" })).toBeNull();
    expect(parseConfigOp({ op: "source.set", id: "openai-blog", enabled: "no" })).toBeNull();
    expect(parseConfigOp({ op: "source.set", id: "openai-blog", pinned: 1 })).toBeNull();
  });

  it("accepts source.update with a name, topics, both, or an empty list for Other", () => {
    const ops: ConfigOp[] = [
      { op: "source.update", id: "openai-blog", name: "OpenAI News" },
      { op: "source.update", id: "openai-blog", topic_ids: ["motion-craft"] },
      { op: "source.update", id: "openai-blog", topic_ids: ["design_engineering_craft"] },
      { op: "source.update", id: "openai-blog", name: "OpenAI", topic_ids: ["a-b", "c_d"] },
      { op: "source.update", id: "openai-blog", topic_ids: [] },
    ];
    for (const op of ops) expect(parseConfigOp(op)).toEqual(op);
  });

  it("rebuilds source.update from its parts, trimming the name", () => {
    expect(
      parseConfigOp({
        op: "source.update",
        id: "openai-blog",
        name: "  OpenAI News ",
        enabled: false,
        removed: true,
      }),
    ).toEqual({ op: "source.update", id: "openai-blog", name: "OpenAI News" });
  });

  it("refuses source.update that changes nothing or breaks a limit", () => {
    const update = (change: Record<string, unknown>) =>
      parseConfigOp({ op: "source.update", id: "openai-blog", ...change });
    expect(update({})).toBeNull();
    expect(update({ name: undefined, topic_ids: undefined })).toBeNull();
    expect(update({ name: "n".repeat(80) })).not.toBeNull();
    expect(update({ name: "n".repeat(81) })).toBeNull();
    expect(update({ name: "" })).toBeNull();
    expect(update({ name: "   " })).toBeNull();
    expect(update({ name: "Open\nforged" })).toBeNull();
    expect(update({ name: 7 })).toBeNull();
    expect(update({ name: null })).toBeNull();
    expect(update({ topic_ids: ["Motion Craft"] })).toBeNull();
    expect(update({ topic_ids: "motion-craft" })).toBeNull();
    expect(update({ topic_ids: null })).toBeNull();
    expect(
      update({ topic_ids: Array.from({ length: 12 }, (_, i) => `topic-${i}`) }),
    ).not.toBeNull();
    expect(update({ topic_ids: Array.from({ length: 13 }, (_, i) => `topic-${i}`) })).toBeNull();
    // A bad name refuses the edit even when the topics are fine.
    expect(update({ name: "", topic_ids: ["motion-craft"] })).toBeNull();
    for (const id of ["A", "has space", "", 7, null, undefined]) {
      expect(parseConfigOp({ op: "source.update", id, name: "Fine" })).toBeNull();
    }
  });

  it("rejects an unknown operation and anything that is not an object", () => {
    for (const bad of [null, "topic.remove", [], 7, { op: "delete.everything" }, {}]) {
      expect(parseConfigOp(bad)).toBeNull();
    }
  });
});

describe("parseConfigOp: profile ops", () => {
  const vote = {
    story_id: "s1",
    url: "https://example.com/a",
    headline: "A headline",
    topic: "design",
    source_id: "example",
    value: "up",
    at: "2026-10-14T10:00:00.000Z",
  };

  it("stores a blocked outlet as its domain and refuses what is not one", () => {
    expect(
      parseConfigOp({ op: "profile.block", domain: "https://www.News.Example.com/a?b#c" }),
    ).toEqual({
      op: "profile.block",
      domain: "news.example.com",
    });
    expect(parseConfigOp({ op: "profile.unblock", domain: "example.com" })).toEqual({
      op: "profile.unblock",
      domain: "example.com",
    });
    for (const domain of ["localhost", "not a domain", "", "http://", "exa_mple.com", 7, null]) {
      expect(parseConfigOp({ op: "profile.block", domain })).toBeNull();
    }
  });

  it("forwards a good vote unchanged and refuses a malformed one", () => {
    expect(
      parseConfigOp({ op: "profile.vote", votes: [vote, { ...vote, value: "clear" }] }),
    ).toEqual({
      op: "profile.vote",
      votes: [vote, { ...vote, value: "clear" }],
      opens: [],
    });
    const bad = [
      [],
      Array.from({ length: 51 }, () => vote),
      [{ ...vote, value: "sideways" }],
      [{ ...vote, headline: "x".repeat(201) }],
      [{ ...vote, at: "yesterday" }],
      [{ ...vote, url: "javascript:alert(1)" }],
      [vote, { ...vote, story_id: undefined }],
    ];
    for (const votes of bad) expect(parseConfigOp({ op: "profile.vote", votes })).toBeNull();
  });
});

describe("parseConfigOp: schedule.set", () => {
  const schedule: ConfigOp = {
    op: "schedule.set",
    hour: 9,
    cadence_days: 3,
    skip_topics: ["trending"],
  };

  it("accepts the topics left out, an empty list too, and rebuilds the edit from its parts", () => {
    expect(parseConfigOp(schedule)).toEqual(schedule);
    expect(parseConfigOp({ ...schedule, skip_topics: [] })).toEqual({
      ...schedule,
      skip_topics: [],
    });
    expect(parseConfigOp({ ...schedule, extra: 1 })).toEqual(schedule);
  });

  it("carries a length and the weekly format, and refuses ones that do not exist", () => {
    const full: ConfigOp = { ...schedule, length_minutes: 15, weekly: { format: "discussion" } };
    expect(parseConfigOp(full)).toEqual(full);
    expect(parseConfigOp({ ...schedule, weekly: { format: "song" } })).toBeNull();
    // The daily podcast has no type: a saved or queued top-level one is read past.
    expect(parseConfigOp({ ...schedule, format: "discussion" })).toEqual(schedule);
    expect(parseConfigOp({ ...schedule, length_minutes: 7 })).toBeNull();
  });

  it("carries the topics the weekly podcast leaves out, and refuses a bad list", () => {
    expect(parseConfigOp({ op: "schedule.set", weekly: { skip_topics: ["design"] } })).toEqual({
      op: "schedule.set",
      weekly: { skip_topics: ["design"] },
    });
    for (const skip_topics of [null, "design", ["Not An Id"]]) {
      expect(parseConfigOp({ op: "schedule.set", weekly: { skip_topics } })).toBeNull();
    }
  });

  it("accepts any subset of the fields and refuses an empty edit", () => {
    expect(parseConfigOp({ op: "schedule.set", hour: 9 })).toEqual({ op: "schedule.set", hour: 9 });
    expect(parseConfigOp({ op: "schedule.set", skip_topics: [] })).toEqual({
      op: "schedule.set",
      skip_topics: [],
    });
    expect(parseConfigOp({ op: "schedule.set", extra: 1 })).toBeNull();
    expect(parseConfigOp({ op: "schedule.set" })).toBeNull();
  });

  it("carries a listed time zone and refuses any other", () => {
    expect(parseConfigOp({ op: "schedule.set", timezone: "Asia/Kolkata" })).toEqual({
      op: "schedule.set",
      timezone: "Asia/Kolkata",
    });
    for (const timezone of ["Mars/Olympus", "", 7, null]) {
      expect(parseConfigOp({ op: "schedule.set", timezone }), String(timezone)).toBeNull();
    }
  });

  it("carries voices, the weekly podcast and the Create defaults, rebuilt from their parts", () => {
    const full: ConfigOp = {
      op: "schedule.set",
      voice_id: "ada_1",
      voice_id_b: null,
      weekly: {
        enabled: true,
        day: 6,
        hour: 18,
        format: "discussion",
        length_minutes: 15,
        voice_id: "ada_1",
        voice_id_b: "leo-2",
      },
      custom: { format: "readout", length_minutes: 3, voice_id: null },
    };
    expect(parseConfigOp(full)).toEqual(full);
    expect(parseConfigOp({ ...full, weekly: { day: 2, extra: 1 } })).toEqual({
      ...full,
      weekly: { day: 2 },
    });
  });

  it("refuses a bad voice id, weekly day or hour, and a headlines type for weekly or custom", () => {
    for (const bad of [
      { ...schedule, voice_id: "has space" },
      { ...schedule, voice_id_b: 7 },
      { ...schedule, weekly: "x" },
      { ...schedule, weekly: { day: 7 } },
      { ...schedule, weekly: { day: 1.5 } },
      { ...schedule, weekly: { hour: 24 } },
      { ...schedule, weekly: { enabled: "yes" } },
      { ...schedule, weekly: { format: "headlines" } },
      { ...schedule, weekly: { length_minutes: 4 } },
      { ...schedule, custom: { format: "headlines" } },
      { ...schedule, custom: { voice_id: "a/b" } },
    ]) {
      expect(parseConfigOp(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses an hour or cadence out of range and a malformed list", () => {
    for (const bad of [
      { ...schedule, hour: 24 },
      { ...schedule, hour: -1 },
      { ...schedule, hour: 7.5 },
      { ...schedule, hour: "7" },
      { ...schedule, cadence_days: 4 },
      { ...schedule, skip_topics: null },
      { ...schedule, skip_topics: ["Bad Id"] },
      { ...schedule, skip_topics: "trending" },
      { ...schedule, skip_topics: Array(201).fill("trending") },
    ]) {
      expect(parseConfigOp(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseConfigRequest", () => {
  it("reads an edit from a JSON body, and ignores a passphrase an older page still sends", () => {
    expect(parseConfigRequest(body(upsert))).toEqual({ op: upsert });
    expect(parseConfigRequest(JSON.stringify({ passphrase: "left over", op: upsert }))).toEqual({
      op: upsert,
    });
  });

  it("reads a list of edits that belong together, in order", () => {
    const add: ConfigOp = {
      op: "source.add",
      url: "https://a.example/feed",
      topic_ids: ["motion-craft"],
    };
    expect(parseConfigRequest(body([upsert, add]))).toEqual({ op: [upsert, add] });
  });

  it("refuses a list that is empty, longer than eight, or holds one bad edit", () => {
    const add: ConfigOp = { op: "source.add", url: "https://a.example/feed" };
    expect(parseConfigRequest(body([]))).toBeNull();
    expect(parseConfigRequest(body(Array(MAX_OPS + 1).fill(add)))).toBeNull();
    expect(parseConfigRequest(body(Array(MAX_OPS).fill(add)))).not.toBeNull();
    expect(
      parseConfigRequest(body([upsert, { op: "source.add", url: "ftp://x.test" }])),
    ).toBeNull();
    expect(parseConfigRequest(body([[upsert]]))).toBeNull();
  });

  it("rejects anything else", () => {
    const padded = `{"op":{"op":"topic.remove","id":"ab"},"pad":"${"y".repeat(MAX_CONFIG_BODY_CHARS)}"}`;
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({}),
      body({ op: "nope" }),
      padded,
    ]) {
      expect(parseConfigRequest(bad)).toBeNull();
    }
  });
});

describe("configCooldownSeconds", () => {
  it("allows an edit when no run is recent", () => {
    expect(configCooldownSeconds([], NOW)).toBe(0);
    expect(configCooldownSeconds([NOW - CONFIG_COOLDOWN_MS], NOW)).toBe(0);
  });

  it("names the seconds left, rounded up, from the newest run", () => {
    expect(configCooldownSeconds([NOW - 3000, NOW - 60_000], NOW)).toBe(7);
    expect(configCooldownSeconds([NOW - 9500], NOW)).toBe(1);
    expect(configCooldownSeconds([NOW], NOW)).toBe(10);
  });
});

describe("handleConfig", () => {
  it("answers 503 and never calls GitHub when the site is not configured", async () => {
    const { deps, github } = setup({ env: {} });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a body that is not the expected shape", async () => {
    const { deps, github } = setup();
    for (const bad of ["", "not json", "{}", body({ op: "nope" })]) {
      expect((await handleConfig(input(bad), deps)).status).toBe(400);
    }
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for another origin", async () => {
    const { deps } = setup();
    const result = await handleConfig(input(body(upsert), "https://evil.example"), deps);
    expect(result.status).toBe(400);
  });

  it("answers 400 for an invalid edit", async () => {
    const { deps } = setup();
    const result = await handleConfig(input(body({ op: "source.add", url: "ftp://x.test" })), deps);
    expect(result.status).toBe(400);
  });

  it("dispatches config.yml on main with the edit as one JSON input and returns 202", async () => {
    const { deps, github, delays } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 4242 } });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({ status: 202, body: { status: 202, run_id: 4242 } });
    expect(delays).toEqual([]);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: { op: JSON.stringify(upsert) },
      return_run_details: true,
    });
  });

  it("dispatches a list of edits as one JSON array in the same input, after one cooldown check", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 77 } });
    const add: ConfigOp = {
      op: "source.add",
      url: "https://a.example/feed",
      topic_ids: ["motion-craft"],
    };
    const result = await handleConfig(
      input(body([upsert, add, { ...add, url: "https://b.example/rss" }])),
      deps,
    );
    expect(result).toEqual({ status: 202, body: { status: 202, run_id: 77 } });
    const posts = github.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      ref: "main",
      inputs: {
        op: JSON.stringify([upsert, add, { ...add, url: "https://b.example/rss" }]),
      },
      return_run_details: true,
    });
  });

  it("dispatches a list of one as the edit itself, as before", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 5 } });
    await handleConfig(input(body([upsert])), deps);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toMatchObject({ inputs: { op: JSON.stringify(upsert) } });
  });

  it("refuses a list while the cooldown holds, as it would one edit", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [runJson({ created_at: secondsAgo(3) })] } });
    const add: ConfigOp = { op: "source.add", url: "https://a.example/feed" };
    const result = await handleConfig(input(body([upsert, add])), deps);
    expect(result.status).toBe(429);
    expect(github.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("dispatches a source.update as it was validated, alone or with another edit", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 12 } });
    const update: ConfigOp = { op: "source.update", id: "openai-blog", topic_ids: [] };
    const pin: ConfigOp = { op: "source.set", id: "openai-blog", pinned: true };
    const result = await handleConfig(
      input(body([{ ...update, name: " OpenAI ", extra: 1 }, pin])),
      deps,
    );
    expect(result).toEqual({ status: 202, body: { status: 202, run_id: 12 } });
    const dispatch = github.requests.find((request) => request.method === "POST");
    const sent = (dispatch?.body as { inputs?: { op?: string } } | undefined)?.inputs?.op;
    expect(JSON.parse(sent ?? "null")).toEqual([{ ...update, name: "OpenAI" }, pin]);
  });

  it("answers 400 for a source.update that changes nothing", async () => {
    const { deps, github } = setup();
    const result = await handleConfig(
      input(body({ op: "source.update", id: "openai-blog" })),
      deps,
    );
    expect(result.status).toBe(400);
    expect(github.requests).toHaveLength(0);
  });

  it("dispatches only the validated edit, whatever else the caller sends", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 1 } });
    const hostile = JSON.stringify({
      ref: "evil",
      inputs: { mode: "weekly" },
      op: { op: "source.remove", id: "openai-blog", extra: "x" },
    });
    await handleConfig(input(hostile), deps);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: { op: '{"op":"source.remove","id":"openai-blog"}' },
      return_run_details: true,
    });
  });

  describe("schedule.set", () => {
    const schedule: ConfigOp = { op: "schedule.set", hour: 9, cadence_days: 2 };
    const VARIABLE = "PATCH /actions/variables/RUN_CRON";
    const CREATE = "POST /actions/variables";
    const variableCalls = (github: ReturnType<typeof setup>["github"]) =>
      github.requests.filter((request) => request.path.startsWith("/actions/variables"));

    it("dispatches the edit, then sets RUN_CRON to the chosen hour", async () => {
      const { deps, github } = setup();
      github.on(RUNS, { json: { workflow_runs: [] } });
      github.on(DISPATCH, { json: { workflow_run_id: 31 } });
      github.on(VARIABLE, { status: 204 });
      const result = await handleConfig(input(body(schedule)), deps);
      expect(result).toEqual({
        status: 202,
        body: { status: 202, run_id: 31, time_changed: true },
      });
      const calls = variableCalls(github);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: "PATCH",
        path: "/actions/variables/RUN_CRON",
        body: { name: "RUN_CRON", value: "13 9 * * *" },
      });
    });

    it("creates the variable when it does not exist yet", async () => {
      const { deps, github } = setup();
      github.on(RUNS, { json: { workflow_runs: [] } });
      github.on(DISPATCH, { json: { workflow_run_id: 31 } });
      github.on(CREATE, { status: 201 });
      const result = await handleConfig(input(body([upsert, schedule])), deps);
      expect(result).toMatchObject({ status: 202, body: { time_changed: true } });
      expect(variableCalls(github).map((request) => request.method)).toEqual(["PATCH", "POST"]);
      expect(variableCalls(github)[1]?.body).toEqual({ name: "RUN_CRON", value: "13 9 * * *" });
    });

    it("still answers 202 and says the time was not changed when GitHub refuses", async () => {
      const { deps, github, logs } = setup();
      github.on(RUNS, { json: { workflow_runs: [] } });
      github.on(DISPATCH, { json: { workflow_run_id: 31 } });
      github.on(VARIABLE, { status: 403 });
      const result = await handleConfig(input(body(schedule)), deps);
      expect(result).toEqual({
        status: 202,
        body: { status: 202, run_id: 31, time_changed: false },
      });
      expect(logs.join(" ")).toContain("403");
      expect(JSON.stringify([result, logs])).not.toContain(TOKEN);
    });

    // RUN_CRON is Stockholm time: a New York 09:00 written as 09 would run six hours early.
    it.each([
      ["a new hour in the stored zone", { op: "schedule.set", hour: 9 }, "13 15 * * *"],
      [
        "a new zone at the stored hour",
        { op: "schedule.set", timezone: "Asia/Tokyo" },
        "13 0 * * *",
      ],
    ])("sets RUN_CRON to the Stockholm hour for %s", async (_name, op, value) => {
      const { deps, github } = setup();
      github.on(RUNS, { json: { workflow_runs: [] } });
      github.on(DISPATCH, { json: { workflow_run_id: 31 } });
      github.on(VARIABLE, { status: 204 });
      github.on("GET /contents/config/schedule.json", {
        text: JSON.stringify({
          version: 1,
          timezone: "America/New_York",
          hour: 7,
          cadence_days: 2,
        }),
      });
      await handleConfig(input(body(op)), deps);
      expect(variableCalls(github)[0]?.body).toEqual({ name: "RUN_CRON", value });
    });

    it("leaves the variable alone for an edit without a schedule", async () => {
      const { deps, github } = setup();
      github.on(RUNS, { json: { workflow_runs: [] } });
      github.on(DISPATCH, { json: { workflow_run_id: 31 } });
      const result = await handleConfig(input(body(upsert)), deps);
      expect(result).toEqual({ status: 202, body: { status: 202, run_id: 31 } });
      expect(variableCalls(github)).toHaveLength(0);
    });

    it("does not touch the variable while the cooldown holds", async () => {
      const { deps, github } = setup();
      github.on(RUNS, { json: { workflow_runs: [runJson({ created_at: secondsAgo(3) })] } });
      expect((await handleConfig(input(body(schedule)), deps)).status).toBe(429);
      expect(variableCalls(github)).toHaveLength(0);
    });
  });

  it("never touches run.yml", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 1 } });
    await handleConfig(input(body(upsert)), deps);
    expect(github.requests.every((request) => !request.path.includes("run.yml"))).toBe(true);
  });

  it("answers 429 with the seconds left when an edit ran a moment ago", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [runJson({ created_at: secondsAgo(4) })] } });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({
      status: 429,
      headers: { "Retry-After": "6" },
      body: { status: 429, error: "cooldown", retry_after_s: 6 },
    });
    expect(github.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("allows an edit once the cooldown has passed", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [runJson({ created_at: secondsAgo(11) })] } });
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    expect((await handleConfig(input(body(upsert)), deps)).status).toBe(202);
  });

  it("finds the run by listing when GitHub dispatches without naming it", async () => {
    const { deps, github, delays } = setup();
    let listings = 0;
    github.on(RUNS, () => {
      listings += 1;
      return {
        json: {
          workflow_runs:
            listings === 1
              ? []
              : [runJson({ id: 777, created_at: new Date(NOW + 1000).toISOString() })],
        },
      };
    });
    github.on(DISPATCH, { status: 204 });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toMatchObject({ status: 202, body: { run_id: 777 } });
    expect(delays.length).toBeGreaterThan(0);
  });

  it("answers 202 even when GitHub 204 dispatches without any run listed yet", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { status: 204 });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({ status: 202, body: { status: 202 } });
  });

  it("answers 503 when GitHub fails, with a generic body and a log of the status only", async () => {
    const { deps, github, logs } = setup();
    github.on(RUNS, { status: 404, json: { message: "Not Found" } });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("Not Found");
    expect(logs).toEqual(["config failed: GitHubError: GitHub answered 404"]);
  });

  it("never puts the token in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handleConfig(input(body(upsert)), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(logs[0]).toContain("[redacted]");
  });
});

/**
 * An in-memory config_documents table that answers the statements the store sends, with the same
 * version rule as the SQL: a write lands only if every document is still at the version read.
 */
function fakeStore(rows: { path: string; content: string; version: number }[]) {
  let afterRead = () => {};
  const sql: SqlClient = {
    async query(text, params = []) {
      if (text.startsWith("select path, content, version")) {
        const only = params[0] as string[] | undefined;
        const copy = rows
          .filter((row) => only === undefined || only.includes(row.path))
          .map((row) => ({ ...row }));
        afterRead();
        return copy;
      }
      if (text.includes("max(updated_at)")) return [{ at: null }];
      const [paths, contents, versions] = params as [string[], string[], (number | null)[]];
      const fine = paths.every((path, index) => {
        const row = rows.find((entry) => entry.path === path);
        return versions[index] === null ? row === undefined : row?.version === versions[index];
      });
      if (!fine) return [{ written: 0 }];
      paths.forEach((path, index) => {
        const row = rows.find((entry) => entry.path === path);
        if (row) Object.assign(row, { content: contents[index], version: row.version + 1 });
        else rows.push({ path, content: contents[index] as string, version: 1 });
      });
      return [{ written: paths.length }];
    },
  };
  return {
    sql,
    rows,
    onRead: (hook: () => void) => {
      afterRead = hook;
    },
  };
}

const PREFERENCES = JSON.stringify({
  profile: "",
  focus: "",
  weights: Object.fromEntries(CATEGORIES.map((category) => [category, 0.5])),
  preferred_keywords: [],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
});

describe("handleConfig with the config store on (D149)", () => {
  const block: ConfigOp = { op: "profile.block", domain: "spam.example" };
  const storeDeps = (store: ReturnType<typeof fakeStore>): Partial<ConfigDeps> => ({
    env: {
      GITHUB_SINGULARITY_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
      DATABASE_URL: "postgres://fake",
      SINGULARITY_CONFIG_STORE: "postgres",
    },
    connectConfigStore: async () => store.sql,
    baseFiles: { "config/sources.json": JSON.stringify({ version: 1, sources: [] }) },
  });

  const OWNER = (domains: string[]) =>
    JSON.stringify({ user_id: "owner", blocked_domains: domains, votes: [], opens: [] });
  const builtFiles = {
    "config/preferences.json": PREFERENCES,
    "config/profiles/owner.json": OWNER([]),
    "config/sources.json": JSON.stringify({ version: 1, sources: [] }),
  };

  // The bugs: an edit that waits on a workflow and a rebuild, and a public read that hands out the
  // owner's private history along with the settings.
  it("saves the edit where every device reads it at once, as an edit over the built page", async () => {
    const store = fakeStore([
      { path: "config/preferences.json", content: PREFERENCES, version: 1 },
      { path: "config/writer.json", content: '{"provider":"private"}', version: 1 },
    ]);
    const { deps, github, logs } = setup(storeDeps(store));
    const result = await handleConfig(input(body(block)), deps);
    expect({ status: result.status, logs }).toEqual({ status: 202, logs: [] });
    expect(github.requests).toHaveLength(0);
    const read = await handleConfigRead({ ...deps, storeUrl: "postgres://fake", builtFiles });
    expect((read.body as ConfigReadBody).ops).toEqual([block]);
    expect(JSON.stringify(read.body)).not.toContain("private");
  });

  // The bug: an edit the function refused (a source added to a topic that is not there, a page that
  // is a source already) answered a bare 400, and the page said only that the server turned it down.
  it("tells the page why an edit was refused", async () => {
    const store = fakeStore([
      { path: "config/preferences.json", content: PREFERENCES, version: 1 },
    ]);
    const { deps } = setup(storeDeps(store));
    const add: ConfigOp = {
      op: "source.add",
      url: "https://blog.example.com/",
      topic_ids: ["no_such_topic"],
    };
    // The refusal names the op, so the page can drop that change and send the others (2026-10-24).
    const result = await handleConfig(
      input(body([{ op: "schedule.set", hour: 7 } satisfies ConfigOp, add])),
      deps,
    );
    expect(result.body).toEqual({
      status: 400,
      error: "invalid_request",
      reason: "There is no topic no_such_topic.",
      op_index: 1,
    });
  });

  // The bug (D149, review round 2): an edit from another device landing between this edit's read
  // and its write answered 409, which the page cannot resolve; it is applied once more on top.
  it("applies an edit again on top of one that landed meanwhile, and gives up after that", async () => {
    const store = fakeStore([
      { path: "config/preferences.json", content: PREFERENCES, version: 1 },
    ]);
    const { deps } = setup(storeDeps(store));
    let reads = 0;
    store.onRead(() => {
      reads += 1;
      if (reads > 1) return;
      store.rows.push({
        path: "config/profiles/owner.json",
        content: OWNER(["other.example"]),
        version: 1,
      });
    });
    expect((await handleConfig(input(body(block)), deps)).status).toBe(202);
    const owner = store.rows.find((row) => row.path === "config/profiles/owner.json");
    expect(JSON.parse(owner?.content ?? "{}").blocked_domains).toEqual([
      "other.example",
      "spam.example",
    ]);

    const busy = fakeStore([
      { path: "config/preferences.json", content: PREFERENCES, version: 1 },
      { path: "config/profiles/owner.json", content: OWNER([]), version: 1 },
    ]);
    busy.onRead(() => {
      const row = busy.rows.find((entry) => entry.path === "config/profiles/owner.json");
      if (row) row.version += 1;
    });
    const later = setup(storeDeps(busy));
    expect((await handleConfig(input(body(block)), later.deps)).status).toBe(409);
  });
});
