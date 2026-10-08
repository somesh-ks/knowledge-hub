import { hashPassphrase, verifyPassphrase } from "@dispatch/core/passphrase";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import type { PodcastRequest } from "../types/contracts";
import { WRONG_PASSPHRASE_DELAY_MS } from "./generate";
import { PODCAST_COOLDOWN_MS, PODCAST_DAILY_CAP } from "./limits";
import {
  handlePodcast,
  MAX_TITLE_CHARS,
  type PodcastDeps,
  parsePodcastBody,
  parsePodcastRequest,
} from "./podcast";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const PASSPHRASE = "correct horse battery staple";
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const RUNS = "GET /actions/workflows/podcast.yml/runs";
const DISPATCH = "POST /actions/workflows/podcast.yml/dispatches";
const podcastRun = (overrides: Record<string, unknown> = {}) =>
  runJson({ path: ".github/workflows/podcast.yml", ...overrides });

let passphraseHash = "";

beforeAll(async () => {
  passphraseHash = await hashPassphrase(PASSPHRASE);
});

const REQUEST: PodcastRequest = {
  topic_ids: ["ai", "research"],
  length_minutes: 5,
  format: "discussion",
  window_days: 7,
  tone: "dry",
  title: "My week in AI",
};

function setup(overrides: Partial<PodcastDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: PodcastDeps = {
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

const body = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ passphrase: PASSPHRASE, request: REQUEST, ...fields });
const input = (bodyText: string, origin: string | null = ORIGIN) => ({
  bodyText,
  origin,
  expectedOrigin: ORIGIN,
});

describe("parsePodcastRequest", () => {
  it("keeps a valid request as it is", () => {
    expect(parsePodcastRequest(REQUEST)).toEqual(REQUEST);
  });

  it("leaves the title out when it is empty or only spaces", () => {
    expect(parsePodcastRequest({ ...REQUEST, title: "   " })).not.toHaveProperty("title");
    expect(parsePodcastRequest({ ...REQUEST, title: undefined })).not.toHaveProperty("title");
  });

  it("trims the title and turns control characters into spaces", () => {
    expect(parsePodcastRequest({ ...REQUEST, title: "  Up\nnext  " })?.title).toBe("Up next");
  });

  it("drops every field it does not know", () => {
    const parsed = parsePodcastRequest({ ...REQUEST, ref: "evil", inputs: { mode: "weekly" } });
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      "format",
      "length_minutes",
      "title",
      "tone",
      "topic_ids",
      "window_days",
    ]);
  });

  it("rejects a request that breaks any rule", () => {
    const bad: unknown[] = [
      null,
      "ai",
      [],
      { ...REQUEST, topic_ids: [] },
      { ...REQUEST, topic_ids: ["ai", "ai"] },
      { ...REQUEST, topic_ids: ["Not A Section!"] },
      { ...REQUEST, topic_ids: [""] },
      { ...REQUEST, topic_ids: ["x".repeat(65)] },
      { ...REQUEST, topic_ids: [7] },
      { ...REQUEST, topic_ids: "ai" },
      {
        ...REQUEST,
        topic_ids: ["top", "ui-craft", "ai", "tech", "research", "launches", "watch"],
      },
      { ...REQUEST, length_minutes: 4 },
      { ...REQUEST, length_minutes: "5" },
      { ...REQUEST, format: "essay" },
      { ...REQUEST, window_days: 3 },
      { ...REQUEST, tone: "angry" },
      { ...REQUEST, audience: "everyone" },
      { ...REQUEST, audience: 1 },
      { ...REQUEST, audience: null },
      { ...REQUEST, title: 12 },
      { ...REQUEST, title: "x".repeat(MAX_TITLE_CHARS + 1) },
    ];
    for (const request of bad)
      expect(parsePodcastRequest(request), JSON.stringify(request)).toBeNull();
  });

  it("accepts the six general topics with the general audience", () => {
    const topic_ids = ["world", "business", "technology", "science", "culture", "sports"];
    const parsed = parsePodcastRequest({ ...REQUEST, audience: "general", topic_ids });
    expect(parsed?.audience).toBe("general");
    expect(parsed?.topic_ids).toEqual(topic_ids);
  });

  it("keeps the audience when it is general or custom, and leaves it out when it is absent", () => {
    expect(parsePodcastRequest({ ...REQUEST, audience: "general" })?.audience).toBe("general");
    expect(parsePodcastRequest({ ...REQUEST, audience: "custom" })?.audience).toBe("custom");
    expect(parsePodcastRequest(REQUEST)).not.toHaveProperty("audience");
  });

  it("accepts the new sections and the section of a topic the owner added", () => {
    const ids = ["design", "ui-craft", "ai", "tech", "trending", "audio_interfaces"];
    expect(parsePodcastRequest({ ...REQUEST, topic_ids: ids })?.topic_ids).toEqual(ids);
  });

  it("allows six topics", () => {
    const six = ["top", "ui-craft", "ai", "tech", "research", "launches"];
    expect(parsePodcastRequest({ ...REQUEST, topic_ids: six })?.topic_ids).toEqual(six);
  });
});

describe("parsePodcastBody", () => {
  it("reads the passphrase and the request", () => {
    expect(parsePodcastBody(body())).toEqual({ passphrase: PASSPHRASE, request: REQUEST });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      body({ passphrase: "" }),
      body({ passphrase: 42 }),
      body({ request: undefined }),
      body({ request: { ...REQUEST, length_minutes: 99 } }),
      body({ passphrase: "x".repeat(257) }),
      body({ pad: "y".repeat(2048) }),
    ]) {
      expect(parsePodcastBody(bad)).toBeNull();
    }
  });
});

describe("handlePodcast", () => {
  it("answers 503 and never calls GitHub when the site is not configured", async () => {
    const { deps, github } = setup({ env: {} });
    const result = await handlePodcast(input(body()), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a body that is not the expected shape, before any passphrase check", async () => {
    const verify = vi.fn(async () => true);
    const { deps, github } = setup({ verifyPassphrase: verify });
    for (const bad of ["", "not json", "{}", body({ request: { ...REQUEST, topic_ids: [] } })]) {
      expect((await handlePodcast(input(bad), deps)).status).toBe(400);
    }
    expect(verify).not.toHaveBeenCalled();
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a request from another origin before checking the passphrase", async () => {
    const verify = vi.fn(async () => true);
    const { deps } = setup({ verifyPassphrase: verify });
    const result = await handlePodcast(input(body(), "https://evil.example"), deps);
    expect(result.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 401 with a constant extra delay for a wrong passphrase", async () => {
    const { deps, delays, github } = setup();
    const result = await handlePodcast(input(body({ passphrase: "not the passphrase" })), deps);
    expect(result).toEqual({ status: 401, body: { status: 401, error: "wrong_passphrase" } });
    expect(delays).toEqual([WRONG_PASSPHRASE_DELAY_MS]);
    expect(github.requests).toHaveLength(0);
  });

  it("dispatches podcast.yml on main with the request as its one input and returns 202", async () => {
    const { deps, github, delays } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 4242 } });
    const result = await handlePodcast(input(body()), deps);
    expect(result).toEqual({
      status: 202,
      body: { status: 202, run_id: 4242, started_at: "2026-10-07T12:00:00.000Z" },
    });
    expect(delays).toEqual([]);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: { request: JSON.stringify(REQUEST) },
      return_run_details: true,
    });
  });

  it("sends only the checked fields, whatever else the caller adds", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 1 } });
    const hostile = JSON.stringify({
      passphrase: PASSPHRASE,
      request: { ...REQUEST, ref: "evil", inputs: { mode: "weekly" } },
      ref: "evil",
      inputs: { mode: "weekly" },
    });
    await handlePodcast(input(hostile), deps);
    const dispatch = github.requests.find((request) => request.method === "POST");
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: { request: JSON.stringify(REQUEST) },
      return_run_details: true,
    });
  });

  it("counts only podcast runs, not briefing runs", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 1 } });
    await handlePodcast(input(body()), deps);
    expect(github.requests.some((request) => request.path.includes("/run.yml/"))).toBe(false);
  });

  it("answers 429 with the time left during the cooldown", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [podcastRun({ created_at: minutesAgo(1) })] } });
    const result = await handlePodcast(input(body()), deps);
    const wait = PODCAST_COOLDOWN_MS / 1000 - 60;
    expect(result).toEqual({
      status: 429,
      headers: { "Retry-After": String(wait) },
      body: { status: 429, error: "cooldown", retry_after_s: wait },
    });
    expect(github.requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("allows a day's episodes up to the cap and answers 429 for the next", async () => {
    const { deps, github } = setup();
    // Spread between one and five hours ago, the oldest exactly five hours back.
    const runsToday = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        podcastRun({
          id: index + 1,
          created_at: minutesAgo(index === count - 1 ? 5 * 60 : 60 + index * 10),
        }),
      );
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    github.on(RUNS, { json: { workflow_runs: runsToday(PODCAST_DAILY_CAP - 1) } });
    expect((await handlePodcast(input(body()), deps)).status).toBe(202);

    github.on(RUNS, { json: { workflow_runs: runsToday(PODCAST_DAILY_CAP) } });
    const refused = await handlePodcast(input(body()), deps);
    expect(refused).toMatchObject({
      status: 429,
      body: { error: "daily_cap", retry_after_s: 19 * 3600 },
    });
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
              : [podcastRun({ id: 777, created_at: new Date(NOW + 1000).toISOString() })],
        },
      };
    });
    github.on(DISPATCH, { status: 204 });
    const result = await handlePodcast(input(body()), deps);
    expect(result).toMatchObject({ status: 202, body: { run_id: 777 } });
    expect(delays.length).toBeGreaterThan(0);
  });

  it("answers 503 when GitHub fails, with a generic body and a redacted log", async () => {
    const { deps, github, logs } = setup();
    github.on(RUNS, { status: 401, json: { message: "Bad credentials" } });
    const result = await handlePodcast(input(body()), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("Bad credentials");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("GitHub answered 401");
  });

  it("never puts the token, the hash or the passphrase in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN} and ${passphraseHash}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handlePodcast(input(body()), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(passphraseHash);
    expect(everything).not.toContain(PASSPHRASE);
    expect(logs[0]).toContain("[redacted]");
  });
});
