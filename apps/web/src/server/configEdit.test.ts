import { hashPassphrase, verifyPassphrase } from "@dispatch/core/passphrase";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import type { ConfigOp } from "../types/contracts";
import { readServerConfig } from "./config";
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
import { WRONG_PASSPHRASE_DELAY_MS } from "./generate";
import { createWorkflowDispatcher } from "./github";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const PASSPHRASE = "correct horse battery staple";
const RUNS = "GET /actions/workflows/config.yml/runs";
const DISPATCH = "POST /actions/workflows/config.yml/dispatches";
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

let passphraseHash = "";

beforeAll(async () => {
  passphraseHash = await hashPassphrase(PASSPHRASE);
});

function setup(overrides: Partial<ConfigDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: ConfigDeps = {
    env: {
      GITHUB_DISPATCH_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
      GENERATE_PASSPHRASE_HASH: passphraseHash,
    },
    fetch: github.fetch,
    now: () => NOW,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
    verifyPassphrase,
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { github, deps, delays, logs };
}

const topic = {
  id: "motion-craft",
  name: "Motion craft",
  description: "Springs, easing and the feel of interfaces in motion.",
  weight: 0.75,
  enabled: true,
  keywords: ["spring", "easing"],
  section_id: "ui-craft",
};
const upsert: ConfigOp = { op: "topic.upsert", topic };

const body = (op: unknown, passphrase: unknown = PASSPHRASE) => JSON.stringify({ passphrase, op });
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
      { op: "source.set", id: "openai-blog", enabled: false },
      { op: "source.set", id: "openai-blog", pinned: true },
      { op: "source.remove", id: "openai-blog" },
      { op: "weights.set", weights: { "motion-craft": 0, other_topic: 1 } },
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
    expect(bad({ weight: -0.1 })).toBeNull();
    expect(bad({ weight: 1.1 })).toBeNull();
    expect(bad({ weight: Number.NaN })).toBeNull();
    expect(bad({ weight: "0.5" })).toBeNull();
    expect(bad({ weight: 0 })).not.toBeNull();
    expect(bad({ weight: 1 })).not.toBeNull();
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

  it("checks every weight", () => {
    expect(parseConfigOp({ op: "weights.set", weights: {} })).toBeNull();
    expect(parseConfigOp({ op: "weights.set", weights: { "bad id": 0.5 } })).toBeNull();
    expect(parseConfigOp({ op: "weights.set", weights: { fine: 2 } })).toBeNull();
    expect(parseConfigOp({ op: "weights.set", weights: [0.5] })).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`topic-${i}`, 0.5]));
    expect(parseConfigOp({ op: "weights.set", weights: many })).toBeNull();
  });

  it("rejects an unknown operation and anything that is not an object", () => {
    for (const bad of [null, "topic.remove", [], 7, { op: "delete.everything" }, {}]) {
      expect(parseConfigOp(bad)).toBeNull();
    }
  });
});

describe("parseConfigOp: schedule.set", () => {
  const schedule: ConfigOp = { op: "schedule.set", hour: 9, cadence_days: 3, sections: ["ai"] };

  it("accepts a list of sections or null, and rebuilds the edit from its parts", () => {
    expect(parseConfigOp(schedule)).toEqual(schedule);
    expect(parseConfigOp({ ...schedule, sections: null })).toEqual({ ...schedule, sections: null });
    expect(parseConfigOp({ ...schedule, extra: 1 })).toEqual(schedule);
  });

  it("refuses an hour or cadence out of range and a malformed list", () => {
    for (const bad of [
      { ...schedule, hour: 24 },
      { ...schedule, hour: -1 },
      { ...schedule, hour: 7.5 },
      { ...schedule, hour: "7" },
      { ...schedule, cadence_days: 4 },
      { ...schedule, cadence_days: undefined },
      { ...schedule, sections: [] },
      { ...schedule, sections: undefined },
      { ...schedule, sections: ["Bad Id"] },
      { ...schedule, sections: "ai" },
      { ...schedule, sections: Array(61).fill("ai") },
    ]) {
      expect(parseConfigOp(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("parseConfigRequest", () => {
  it("reads a passphrase and an edit from a JSON body", () => {
    expect(parseConfigRequest(body(upsert))).toEqual({ passphrase: PASSPHRASE, op: upsert });
  });

  it("reads a list of edits that belong together, in order", () => {
    const add: ConfigOp = {
      op: "source.add",
      url: "https://a.example/feed",
      topic_ids: ["motion-craft"],
    };
    expect(parseConfigRequest(body([upsert, add]))).toEqual({
      passphrase: PASSPHRASE,
      op: [upsert, add],
    });
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
    const padded = `{"passphrase":"x","op":{"op":"topic.remove","id":"ab"},"pad":"${"y".repeat(MAX_CONFIG_BODY_CHARS)}"}`;
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ op: upsert }),
      JSON.stringify({ passphrase: "", op: upsert }),
      JSON.stringify({ passphrase: 7, op: upsert }),
      JSON.stringify({ passphrase: "x".repeat(257), op: upsert }),
      JSON.stringify({ passphrase: "x" }),
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
    for (const bad of ["", "not json", "{}", body({ op: "nope" }), body(upsert, "")]) {
      expect((await handleConfig(input(bad), deps)).status).toBe(400);
    }
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for another origin before checking the passphrase", async () => {
    const verify = vi.fn(async () => true);
    const { deps } = setup({ verifyPassphrase: verify });
    const result = await handleConfig(input(body(upsert), "https://evil.example"), deps);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 400 for an invalid edit before checking the passphrase", async () => {
    const verify = vi.fn(async () => true);
    const { deps } = setup({ verifyPassphrase: verify });
    const result = await handleConfig(input(body({ op: "source.add", url: "ftp://x.test" })), deps);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 401 with a constant extra delay for a wrong passphrase", async () => {
    const { deps, delays, github } = setup();
    const result = await handleConfig(input(body(upsert, "not the passphrase")), deps);
    expect(result).toEqual({ status: 401, body: { status: 401, error: "wrong_passphrase" } });
    expect(delays).toEqual([WRONG_PASSPHRASE_DELAY_MS]);
    expect(github.requests).toHaveLength(0);
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

  it("dispatches only the validated edit, whatever else the caller sends", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 1 } });
    const hostile = JSON.stringify({
      passphrase: PASSPHRASE,
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
    const schedule: ConfigOp = { op: "schedule.set", hour: 9, cadence_days: 2, sections: null };
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

  it("answers 503 when GitHub fails, with a generic body and a log of the status only", async () => {
    const { deps, github, logs } = setup();
    github.on(RUNS, { status: 404, json: { message: "Not Found" } });
    const result = await handleConfig(input(body(upsert)), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("Not Found");
    expect(logs).toEqual(["config failed: GitHubError: GitHub answered 404"]);
  });

  it("never puts the token, the hash or the passphrase in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN} and ${passphraseHash}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handleConfig(input(body(upsert)), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(passphraseHash);
    expect(everything).not.toContain(PASSPHRASE);
    expect(logs[0]).toContain("[redacted]");
  });

  it("never echoes a wrong passphrase", async () => {
    const { deps } = setup();
    const result = await handleConfig(input(body(upsert, "my private guess")), deps);
    expect(JSON.stringify(result)).not.toContain("my private guess");
  });
});

describe("createWorkflowDispatcher", () => {
  const parsed = readServerConfig({
    GITHUB_DISPATCH_TOKEN: TOKEN,
    GITHUB_REPOSITORY: REPO,
    GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
  });
  if (!parsed) throw new Error("test config");

  it("lists workflow_dispatch runs of the named file on main and keeps only the fields it uses", async () => {
    const github = createFakeGitHub();
    github.on(RUNS, {
      json: {
        workflow_runs: [runJson({ id: 5, head_commit: { message: "secret" } }), { id: "x" }],
      },
    });
    const runs = await createWorkflowDispatcher(
      parsed,
      github.fetch,
      "config.yml",
    ).listDispatchRuns();
    expect(runs.map((run) => run.id)).toEqual([5]);
    expect(github.requests[0]?.path).toContain("event=workflow_dispatch");
    expect(github.requests[0]?.path).toContain("branch=main");
    expect(github.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(runs)).not.toContain("secret");
  });

  it("dispatches the named file on main and returns the run id, or null on 204", async () => {
    const github = createFakeGitHub();
    const dispatcher = createWorkflowDispatcher(parsed, github.fetch, "config.yml");
    github.on(DISPATCH, { json: { workflow_run_id: 31 } });
    expect(await dispatcher.dispatch({ op: "{}" })).toBe(31);
    github.on(DISPATCH, { status: 204 });
    expect(await dispatcher.dispatch({ op: "{}" })).toBeNull();
    expect(github.requests[0]?.body).toEqual({
      ref: "main",
      inputs: { op: "{}" },
      return_run_details: true,
    });
  });

  it("fails with the status only when GitHub refuses", async () => {
    const github = createFakeGitHub();
    github.on(DISPATCH, {
      status: 422,
      json: { message: "Workflow does not have workflow_dispatch" },
    });
    await expect(
      createWorkflowDispatcher(parsed, github.fetch, "config.yml").dispatch({ op: "{}" }),
    ).rejects.toThrow("GitHub answered 422");
  });
});
