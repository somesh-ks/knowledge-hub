import { describe, expect, it, vi } from "vitest";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import {
  type GenerateDeps,
  handleGenerate,
  isJsonObjectBody,
  isSameOrigin,
  MAX_BODY_CHARS,
} from "./generate";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600 * 1000).toISOString();

function setup(overrides: Partial<GenerateDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: GenerateDeps = {
    env: {
      GITHUB_DISPATCH_TOKEN: TOKEN,
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

const EMPTY_BODY = "{}";
const input = (bodyText: string, origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});

describe("isJsonObjectBody", () => {
  it("accepts a JSON object, whatever fields it carries", () => {
    expect(isJsonObjectBody("{}")).toBe(true);
    expect(isJsonObjectBody('{"passphrase":"left over from an old build"}')).toBe(true);
  });

  it("rejects anything else, and a body over the size cap", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      "42",
      `{"pad":"${"y".repeat(MAX_BODY_CHARS)}"}`,
    ]) {
      expect(isJsonObjectBody(bad)).toBe(false);
    }
  });
});

describe("isSameOrigin", () => {
  it("accepts a request with no Origin header, like a command-line client", () => {
    expect(isSameOrigin(null, ORIGIN)).toBe(true);
  });

  it("accepts the site's own origin and rejects every other", () => {
    expect(isSameOrigin(ORIGIN, ORIGIN)).toBe(true);
    expect(isSameOrigin("https://evil.example", ORIGIN)).toBe(false);
    expect(isSameOrigin("http://news.someshks.work", ORIGIN)).toBe(false);
    expect(isSameOrigin("null", ORIGIN)).toBe(false);
  });
});

describe("handleGenerate", () => {
  it("answers 503 and never calls GitHub when the site is not configured", async () => {
    const { deps, github } = setup({ env: {} });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a body that is not the expected shape", async () => {
    const { deps } = setup();
    for (const bad of ["", "not json", "[]", "null"]) {
      expect((await handleGenerate(input(bad), deps)).status).toBe(400);
    }
  });

  // The burst cap is shared by every visitor (D150): a request another site sends must not use a
  // slot, or a cross-site loop would hold the owner's minute full.
  it("answers 400 for a request from another origin before taking a burst slot", async () => {
    const burst = vi.fn(async () => 0);
    const { deps } = setup({ burst });
    const result = await handleGenerate(input(EMPTY_BODY, "https://evil.example"), deps);
    expect(result.status).toBe(400);
    expect(burst).not.toHaveBeenCalled();
  });

  it("dispatches run.yml on main with fixed inputs and returns 202 with the run id", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 4242 } });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toEqual({
      status: 202,
      body: { status: 202, run_id: 4242, started_at: "2026-10-07T12:00:00.000Z" },
    });
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toMatchObject({ ref: "main", inputs: { mode: "on-demand" } });
  });

  it("sends the topics chosen for a briefing's Regenerate to run.yml, comma separated, and refuses bad ones", async () => {
    const { deps, github } = setup({ digestIds: () => ["2026-10-07-weekly"] });
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 3 } });
    const send = (topics: unknown) =>
      handleGenerate(
        input(
          JSON.stringify({
            replace: "2026-10-07-weekly",
            topics,
          }),
        ),
        deps,
      );
    expect((await send(["ai", "design_engineering_craft"])).status).toBe(202);
    const dispatched = github.requests.find((request) => request.method === "POST");
    expect(dispatched?.body).toMatchObject({
      inputs: { replace: "2026-10-07-weekly", topics: "ai,design_engineering_craft" },
    });
    for (const bad of [[], ["ai", "ai"], ["Bad Id"], "ai"]) {
      expect((await send(bad)).status).toBe(400);
    }
  });

  it("passes cleaned Regenerate feedback to run.yml and refuses a note over 500 characters", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 7 } });
    const send = (feedback: unknown) => handleGenerate(input(JSON.stringify({ feedback })), deps);
    expect((await send(" Shorter\nsummaries ")).status).toBe(202);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toMatchObject({
      inputs: { mode: "on-demand", feedback: "Shorter summaries" },
    });
    expect((await send("x".repeat(501))).status).toBe(400);
    expect((await send(4)).status).toBe(400);
  });

  it("replaces or deletes only a briefing this build lists, and a delete never uses up a Regenerate's cooldown", async () => {
    const { deps, github } = setup({ digestIds: () => ["2026-10-07", "2026-10-07-weekly"] });
    const recentDelete = runJson({ display_title: "delete 2026-10-05", created_at: hoursAgo(1) });
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [recentDelete] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 5 } });
    const send = (extra: Record<string, unknown>) =>
      handleGenerate(input(JSON.stringify({ ...extra })), deps);
    for (const bad of [
      { replace: "2026-01-01" },
      { replace: "../x" },
      { replace: 7 },
      { action: "delete" },
      { action: "delete", id: "2026-01-01" },
      { action: "remove", id: "2026-10-07" },
    ]) {
      expect((await send(bad)).status).toBe(400);
    }
    const dispatches = () => github.requests.filter((request) => request.method === "POST");
    expect((await send({ replace: "2026-10-07-weekly", feedback: "Shorter" })).status).toBe(202);
    expect(dispatches().at(-1)?.body).toMatchObject({
      inputs: { mode: "on-demand", feedback: "Shorter", replace: "2026-10-07-weekly" },
    });
    expect((await send({ action: "delete", id: "2026-10-07", feedback: "ignored" })).status).toBe(
      202,
    );
    expect(dispatches().at(-1)?.body).toMatchObject({ inputs: { delete: "2026-10-07" } });
    expect(dispatches().at(-1)?.body).not.toHaveProperty("inputs.feedback");
  });

  it("refuses to delete a Daily or Weekly briefing, so only on-demand ones can go", async () => {
    const kinds: Record<string, string> = {
      "2026-10-07": "regular",
      "2026-10-11-weekly": "weekly",
      "2026-10-06": "on-demand",
    };
    const { deps, github } = setup({
      digestIds: () => Object.keys(kinds),
      digestKind: async (id) => kinds[id] ?? null,
    });
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 5 } });
    const remove = (id: string) =>
      handleGenerate(input(JSON.stringify({ action: "delete", id })), deps);
    expect((await remove("2026-10-07")).status).toBe(400);
    expect((await remove("2026-10-11-weekly")).status).toBe(400);
    expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect((await remove("2026-10-06")).status).toBe(202);
  });

  it("uses fixed inputs whatever the caller sends", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 1 } });
    const hostile = JSON.stringify({
      inputs: { mode: "weekly", force: "true" },
      ref: "evil",
    });
    await handleGenerate(input(hostile), deps);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: { mode: "on-demand" },
      return_run_details: true,
    });
  });

  it("answers 429 with the time left during the cooldown", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      json: { workflow_runs: [runJson({ created_at: hoursAgo(2) })] },
    });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toEqual({
      status: 429,
      headers: { "Retry-After": String(4 * 3600) },
      body: { status: 429, error: "cooldown", retry_after_s: 4 * 3600 },
    });
    expect(github.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("answers 429 for the daily cap", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      json: {
        workflow_runs: [
          runJson({ id: 1, created_at: hoursAgo(7) }),
          runJson({ id: 2, created_at: hoursAgo(14) }),
          runJson({ id: 3, created_at: hoursAgo(21) }),
        ],
      },
    });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toMatchObject({
      status: 429,
      body: { error: "daily_cap", retry_after_s: 3 * 3600 },
    });
  });

  it("finds the run by listing when GitHub dispatches without naming it", async () => {
    const { deps, github, delays } = setup();
    let listings = 0;
    github.on("GET /actions/workflows/run.yml/runs", () => {
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
    github.on("POST /actions/workflows/run.yml/dispatches", { status: 204 });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toMatchObject({ status: 202, body: { run_id: 777 } });
    expect(delays.length).toBeGreaterThan(0);
  });

  it("answers 503 when GitHub fails, with a generic body and a redacted log", async () => {
    const { deps, github, logs } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      status: 401,
      json: { message: "Bad credentials" },
    });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("Bad credentials");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("GitHub answered 401");
  });

  it("never puts the token in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handleGenerate(input(EMPTY_BODY), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(logs[0]).toContain("[redacted]");
  });
});
