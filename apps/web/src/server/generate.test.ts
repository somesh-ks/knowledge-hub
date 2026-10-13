import { verifyPassphrase } from "@dispatch/core/passphrase";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cheapPassphraseHash } from "../testing/cheapPassphraseHash";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import {
  type GenerateDeps,
  handleGenerate,
  isSameOrigin,
  MAX_BODY_CHARS,
  parsePassphrase,
  WRONG_PASSPHRASE_DELAY_MS,
} from "./generate";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600 * 1000).toISOString();

let passphraseHash = "";

beforeAll(() => {
  passphraseHash = cheapPassphraseHash("correct horse battery staple");
});

function setup(overrides: Partial<GenerateDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: GenerateDeps = {
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

const body = (passphrase: unknown) => JSON.stringify({ passphrase });
const input = (bodyText: string, origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});

describe("parsePassphrase", () => {
  it("reads a passphrase from a JSON body", () => {
    expect(parsePassphrase('{"passphrase":"hunter2 hunter2"}')).toBe("hunter2 hunter2");
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      '{"passphrase":""}',
      '{"passphrase":42}',
      '{"other":"x"}',
      `{"passphrase":"${"x".repeat(257)}"}`,
      `{"passphrase":"x","pad":"${"y".repeat(MAX_BODY_CHARS)}"}`,
    ]) {
      expect(parsePassphrase(bad)).toBeNull();
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
    const result = await handleGenerate(input(body("anything")), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a body that is not the expected shape", async () => {
    const { deps } = setup();
    for (const bad of ["", "not json", "{}", body(""), body(7)]) {
      expect((await handleGenerate(input(bad), deps)).status).toBe(400);
    }
  });

  it("answers 400 for a request from another origin before checking the passphrase", async () => {
    const verify = vi.fn(async () => true);
    const { deps } = setup({ verifyPassphrase: verify });
    const result = await handleGenerate(input(body("x"), "https://evil.example"), deps);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 401 with a constant extra delay for a wrong passphrase", async () => {
    const { deps, delays, github } = setup();
    const result = await handleGenerate(input(body("not the passphrase")), deps);
    expect(result).toEqual({ status: 401, body: { status: 401, error: "wrong_passphrase" } });
    expect(delays).toEqual([WRONG_PASSPHRASE_DELAY_MS]);
    expect(github.requests).toHaveLength(0);
  });

  it("does not delay a correct passphrase", async () => {
    const { deps, delays, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 99 } });
    await handleGenerate(input(body("correct horse battery staple")), deps);
    expect(delays).toEqual([]);
  });

  it("dispatches run.yml on main with fixed inputs and returns 202 with the run id", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 4242 } });
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
    expect(result).toEqual({
      status: 202,
      body: { status: 202, run_id: 4242, started_at: "2026-10-07T12:00:00.000Z" },
    });
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toMatchObject({ ref: "main", inputs: { mode: "on-demand" } });
  });

  it("passes cleaned Regenerate feedback to run.yml and refuses a note over 500 characters", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 7 } });
    const send = (feedback: unknown) =>
      handleGenerate(
        input(JSON.stringify({ passphrase: "correct horse battery staple", feedback })),
        deps,
      );
    expect((await send(" Shorter\nsummaries ")).status).toBe(202);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toMatchObject({
      inputs: { mode: "on-demand", feedback: "Shorter summaries" },
    });
    expect((await send("x".repeat(501))).status).toBe(400);
    expect((await send(4)).status).toBe(400);
  });

  it("uses fixed inputs whatever the caller sends", async () => {
    const { deps, github } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 1 } });
    const hostile = JSON.stringify({
      passphrase: "correct horse battery staple",
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
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
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
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
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
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
    expect(result).toMatchObject({ status: 202, body: { run_id: 777 } });
    expect(delays.length).toBeGreaterThan(0);
  });

  it("answers 503 when GitHub fails, with a generic body and a redacted log", async () => {
    const { deps, github, logs } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      status: 401,
      json: { message: "Bad credentials" },
    });
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("Bad credentials");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("GitHub answered 401");
  });

  it("never puts the token or the hash in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN} and ${passphraseHash}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handleGenerate(input(body("correct horse battery staple")), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(passphraseHash);
    expect(logs[0]).toContain("[redacted]");
  });

  it("never echoes the submitted passphrase", async () => {
    const { deps } = setup();
    const result = await handleGenerate(input(body("my private guess")), deps);
    expect(JSON.stringify(result)).not.toContain("my private guess");
  });
});
