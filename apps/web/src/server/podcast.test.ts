import { HOST_NAME_POOLS, hostNamesFor } from "@singularity/core/hosts";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeGitHub, REPO, runJson } from "../testing/fakeGitHub";
import type { PodcastRequest } from "../types/contracts";
import { PODCAST_COOLDOWN_MS, PODCAST_DAILY_CAP } from "./limits";
import {
  handlePodcast,
  MAX_TITLE_CHARS,
  type PodcastDeps,
  parsePodcastBody,
  parsePodcastRequest,
} from "./podcast";
import { resetVoicesCache, SPEECHIFY_VOICES_URL } from "./voices";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const TOKEN = "github_pat_secret_value_123456";
const ORIGIN = "https://news.someshks.work";
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const RUNS = "GET /actions/workflows/podcast.yml/runs";
const DISPATCH = "POST /actions/workflows/podcast.yml/dispatches";
// A new Catch up is named "episode" by podcast.yml's run-name (D213).
const podcastRun = (overrides: Record<string, unknown> = {}) =>
  runJson({ path: ".github/workflows/podcast.yml", display_title: "episode", ...overrides });

const EPISODE_ID = "ep-20261007-0900";
const REQUEST: PodcastRequest = {
  topic_ids: ["ai", "research"],
  length_minutes: 5,
  format: "discussion",
  window_days: 7,
  tone: "energetic",
  title: "My week in AI",
};

function setup(overrides: Partial<PodcastDeps> = {}) {
  const github = createFakeGitHub();
  const delays: number[] = [];
  const logs: string[] = [];
  const deps: PodcastDeps = {
    env: {
      GITHUB_SINGULARITY_TOKEN: TOKEN,
      GITHUB_REPOSITORY: REPO,
    },
    fetch: github.fetch,
    now: () => NOW,
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
    episodeIds: () => [EPISODE_ID],
    log: (message) => logs.push(message),
    ...overrides,
  };
  return { github, deps, delays, logs };
}

const body = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ request: REQUEST, ...fields });
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
    const voiced = { ...REQUEST, voice_id: "ada_1", voice_id_b: null };
    expect(parsePodcastRequest(voiced)).toEqual(voiced);
    expect(parsePodcastRequest(REQUEST)).not.toHaveProperty("voice_id");
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

  it("never takes the hosts' names from the caller", () => {
    const forged = { ...REQUEST, host_names: { a: "Mallory", b: "Eve" } };
    expect(parsePodcastRequest(forged)).toEqual(REQUEST);
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
      { ...REQUEST, topic_ids: Array.from({ length: 51 }, (_, index) => `topic-${index}`) },
      { ...REQUEST, length_minutes: 4 },
      { ...REQUEST, length_minutes: "5" },
      { ...REQUEST, format: "essay" },
      { ...REQUEST, format: "headlines" },
      { ...REQUEST, voice_id: "has space" },
      { ...REQUEST, voice_id_b: 4 },
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

  it("sets no limit on topics a person would reach, only a guard on the size", () => {
    const ten = Array.from({ length: 10 }, (_, index) => `topic-${index}`);
    expect(parsePodcastRequest({ ...REQUEST, topic_ids: ten })?.topic_ids).toEqual(ten);
    const fifty = Array.from({ length: 50 }, (_, index) => `topic-${index}`);
    expect(parsePodcastRequest({ ...REQUEST, topic_ids: fifty })?.topic_ids).toEqual(fifty);
  });
});

describe("parsePodcastBody", () => {
  it("reads the request, and ignores a passphrase an older page still sends", () => {
    expect(parsePodcastBody(body())).toEqual({ request: REQUEST });
    expect(parsePodcastBody(body({ passphrase: "left over" }))).toEqual({ request: REQUEST });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      body({ request: undefined }),
      body({ request: { ...REQUEST, length_minutes: 99 } }),
      body({ pad: "y".repeat(2048) }),
    ]) {
      expect(parsePodcastBody(bad)).toBeNull();
    }
  });
});

const action = (fields: Record<string, unknown>) => JSON.stringify({ ...fields });
const del = (fields: Record<string, unknown> = {}) =>
  action({ action: "delete", id: EPISODE_ID, ...fields });
const regen = (fields: Record<string, unknown> = {}) =>
  action({ action: "regenerate", id: EPISODE_ID, feedback: "Shorter intro", ...fields });

describe("parsePodcastBody resume_from", () => {
  // Try again after a failed run sends the failed run's id; anything but a run id must not reach the workflow.
  it("keeps a run id beside the request and rejects anything else", () => {
    const text = (resume: unknown) => JSON.stringify({ request: REQUEST, resume_from: resume });
    expect(parsePodcastBody(text(123456789))).toEqual({
      request: REQUEST,
      resume_from: "123456789",
    });
    expect(parsePodcastBody(text("42"))).toEqual({ request: REQUEST, resume_from: "42" });
    for (const bad of ["abc", "0", "1; rm -rf", "../4", -5, 1.5, null, {}]) {
      expect(parsePodcastBody(text(bad)), String(bad)).toBeNull();
    }
  });
});

describe("parsePodcastBody for an episode action", () => {
  it("reads delete and regenerate", () => {
    expect(parsePodcastBody(del())).toEqual({
      action: "delete",
      id: EPISODE_ID,
    });
    expect(parsePodcastBody(regen({ feedback: "  Less\nhype  " }))).toEqual({
      action: "regenerate",
      id: EPISODE_ID,
      feedback: "Less hype",
    });
  });

  it("accepts feedback of exactly 500 characters and refuses 501", () => {
    expect(parsePodcastBody(regen({ feedback: "x".repeat(500) }))).not.toBeNull();
    expect(parsePodcastBody(regen({ feedback: "x".repeat(501) }))).toBeNull();
  });

  it("takes comments and topics as optional and drops blank comments", () => {
    expect(parsePodcastBody(regen({ feedback: "  \n ", topic_ids: ["ai", "design"] }))).toEqual({
      action: "regenerate",
      id: EPISODE_ID,
      topic_ids: ["ai", "design"],
    });
    expect(parsePodcastBody(regen({ feedback: undefined }))).toEqual({
      action: "regenerate",
      id: EPISODE_ID,
    });
  });

  it("rejects a bad id, an unknown action, bad comments and bad topics", () => {
    for (const bad of [
      del({ id: "ep-2026100-0900" }),
      del({ id: "../ep-20261007-0900" }),
      del({ id: "ep-20261007-0900x" }),
      del({ id: 7 }),
      del({ id: undefined }),
      del({ action: "wipe" }),
      regen({ feedback: 4 }),
      regen({ topic_ids: [] }),
      regen({ topic_ids: ["ai", "ai"] }),
      regen({ topic_ids: ["Bad Id"] }),
    ]) {
      expect(parsePodcastBody(bad), bad).toBeNull();
    }
  });
});

describe("handlePodcast for an episode action", () => {
  const dispatchOf = (github: ReturnType<typeof setup>["github"]) =>
    github.requests.find((request) => request.method === "POST");

  it("dispatches delete with the exact JSON input and returns 202", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 55 } });
    const result = await handlePodcast(input(del()), deps);
    expect(result).toMatchObject({ status: 202, body: { run_id: 55 } });
    expect(dispatchOf(github)?.body).toEqual({
      ref: "main",
      inputs: { request: `{"action":"delete","id":"${EPISODE_ID}"}` },
      return_run_details: true,
    });
  });

  it("dispatches regenerate with the cleaned feedback", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 56 } });
    await handlePodcast(input(regen({ feedback: " Add\tmore design " })), deps);
    expect(dispatchOf(github)?.body).toEqual({
      ref: "main",
      inputs: {
        request: `{"action":"regenerate","id":"${EPISODE_ID}","feedback":"Add more design"}`,
      },
      return_run_details: true,
    });
  });

  it("answers 400 for an id this build does not have", async () => {
    const { deps, github } = setup();
    const result = await handlePodcast(input(del({ id: "ep-20200101-0000" })), deps);
    expect(result.status).toBe(400);
    expect(github.requests).toHaveLength(0);
  });

  it("dispatches the chosen topics with the regenerate request", async () => {
    const { deps, github } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 57 } });
    await handlePodcast(input(regen({ feedback: undefined, topic_ids: ["ai", "design"] })), deps);
    expect(dispatchOf(github)?.body).toMatchObject({
      inputs: {
        request: `{"action":"regenerate","id":"${EPISODE_ID}","topic_ids":["ai","design"]}`,
      },
    });
  });

  it("answers 400 for a malformed id and feedback over the limit", async () => {
    const { deps, github } = setup();
    for (const bad of [del({ id: "nope" }), regen({ feedback: "x".repeat(501) })]) {
      expect((await handlePodcast(input(bad), deps)).status).toBe(400);
    }
    expect(github.requests).toHaveLength(0);
  });

  it("holds delete to a 10 second cooldown and 20 a day, not the episode limits", async () => {
    const { deps, github } = setup();
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

    github.on(RUNS, { json: { workflow_runs: [podcastRun({ created_at: secondsAgo(4) })] } });
    expect(await handlePodcast(input(del()), deps)).toMatchObject({
      status: 429,
      body: { error: "cooldown", retry_after_s: 6 },
    });

    github.on(RUNS, { json: { workflow_runs: [podcastRun({ created_at: secondsAgo(20) })] } });
    expect((await handlePodcast(input(del()), deps)).status).toBe(202);

    const twenty = Array.from({ length: 20 }, (_, index) =>
      podcastRun({ id: index + 1, created_at: minutesAgo(5 + index) }),
    );
    github.on(RUNS, { json: { workflow_runs: twenty } });
    expect(await handlePodcast(input(del()), deps)).toMatchObject({
      status: 429,
      body: { error: "daily_cap" },
    });
  });

  it("holds regenerate to a double-tap cooldown, not the episode limits, and stops at three regenerations (D212)", async () => {
    const { deps, github } = setup({ regenerations: async () => 2 });
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

    // A new episode two minutes ago would hold a new episode; a regenerate waits only 30 seconds.
    github.on(RUNS, { json: { workflow_runs: [podcastRun({ created_at: minutesAgo(1) })] } });
    expect((await handlePodcast(input(regen()), deps)).status).toBe(202);
    github.on(RUNS, { json: { workflow_runs: [podcastRun({ created_at: secondsAgo(10) })] } });
    expect(await handlePodcast(input(regen()), deps)).toMatchObject({
      status: 429,
      body: { error: "cooldown", retry_after_s: 20 },
    });
  });

  it("refuses the fourth regeneration of an episode before it costs a run", async () => {
    const { deps, github } = setup({ regenerations: async () => 3 });
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    expect(await handlePodcast(input(regen()), deps)).toMatchObject({
      status: 409,
      body: { error: "regeneration_limit" },
    });
    expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    // A count that cannot be read is "try again", never 0.
    const blind = setup({ regenerations: async () => null });
    blind.github.on(RUNS, { json: { workflow_runs: [] } });
    expect((await handlePodcast(input(regen()), blind.deps)).status).toBe(503);
    expect(blind.github.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    // Delete is not a regeneration.
    expect((await handlePodcast(input(del()), deps)).status).toBe(202);
  });
});

describe("handlePodcast", () => {
  it("answers 503 and never calls GitHub when the site is not configured", async () => {
    const { deps, github } = setup({ env: {} });
    const result = await handlePodcast(input(body()), deps);
    expect(result).toEqual({ status: 503, body: { status: 503, error: "unavailable" } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a body that is not the expected shape", async () => {
    const { deps, github } = setup();
    for (const bad of ["", "not json", "{}", body({ request: { ...REQUEST, topic_ids: [] } })]) {
      expect((await handlePodcast(input(bad), deps)).status).toBe(400);
    }
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a request from another origin", async () => {
    const { deps } = setup();
    const result = await handlePodcast(input(body(), "https://evil.example"), deps);
    expect(result.status).toBe(400);
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

  it("lets failed tries run up to twelve a day, then answers 429 for the next", async () => {
    const { deps, github } = setup();
    // Spread between one and five hours ago, the oldest exactly five hours back. A failed run
    // is not a Catch up (D213), so only the twelve-a-day guard on tries applies.
    const failedToday = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        podcastRun({
          id: index + 1,
          status: "completed",
          conclusion: "failure",
          created_at: minutesAgo(index === count - 1 ? 5 * 60 : 60 + index * 10),
        }),
      );
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    github.on(RUNS, { json: { workflow_runs: failedToday(PODCAST_DAILY_CAP - 1) } });
    expect((await handlePodcast(input(body()), deps)).status).toBe(202);

    github.on(RUNS, { json: { workflow_runs: failedToday(PODCAST_DAILY_CAP) } });
    const refused = await handlePodcast(input(body()), deps);
    expect(refused).toMatchObject({
      status: 429,
      body: { error: "daily_cap", retry_after_s: 19 * 3600 },
    });
  });

  it("allows two Catch ups a day that came out or are being made, and a third waits for the oldest to age out (D213)", async () => {
    const { deps, github } = setup();
    github.on(DISPATCH, { json: { workflow_run_id: 9 } });
    const done = (id: number, hoursAgo: number) =>
      podcastRun({
        id,
        status: "completed",
        conclusion: "success",
        created_at: minutesAgo(hoursAgo * 60),
      });
    const failed = (id: number, hoursAgo: number) =>
      podcastRun({
        id,
        status: "completed",
        conclusion: "failure",
        created_at: minutesAgo(hoursAgo * 60),
      });
    const making = (id: number, hoursAgo: number) =>
      podcastRun({ id, created_at: minutesAgo(hoursAgo * 60) });
    const aTry = async (runs: unknown[]) => {
      github.on(RUNS, { json: { workflow_runs: runs } });
      return handlePodcast(input(body()), deps);
    };

    // One made, one failed, one deleted and one regenerated since: still room for a second.
    const others = [
      failed(2, 3),
      podcastRun({
        id: 3,
        display_title: `delete ${EPISODE_ID}`,
        status: "completed",
        conclusion: "success",
        created_at: minutesAgo(120),
      }),
      podcastRun({
        id: 4,
        display_title: `regenerate ${EPISODE_ID}`,
        status: "completed",
        conclusion: "success",
        created_at: minutesAgo(90),
      }),
    ];
    expect((await aTry([done(1, 5), ...others])).status).toBe(202);

    // Two came out (or one is still being made): the third waits until the older one is a day old.
    const refused = await aTry([done(1, 5), making(2, 3)]);
    expect(refused).toMatchObject({
      status: 429,
      body: { error: "daily_cap", retry_after_s: 19 * 3600 },
    });
    expect(await aTry([done(1, 25), done(2, 3)])).toMatchObject({ status: 202 });
    expect(github.requests.filter((request) => request.method === "POST")).toHaveLength(2);
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
    // The other line says why the discussion's hosts were not named: the setup has no Speechify key.
    const failures = logs.filter((line) => line.startsWith("podcast failed"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("GitHub answered 401");
    expect(logs.join("\n")).not.toContain("Bad credentials");
  });

  it("never puts the token in any response or log", async () => {
    const throwing = async () => {
      throw new Error(`network down while using ${TOKEN}`);
    };
    const { deps, logs } = setup({ fetch: throwing });
    const result = await handlePodcast(input(body()), deps);
    const everything = JSON.stringify(result) + logs.join("\n");
    expect(everything).not.toContain(TOKEN);
    expect(logs.find((line) => line.startsWith("podcast failed"))).toContain("[redacted]");
  });
});

describe("handlePodcast and the hosts' names", () => {
  // Made up, and one of the invented values .gitleaks.toml already names.
  const SPEECHIFY_KEY = "key-123456789";
  const voice = (id: string, name: string, gender: string) => ({
    id,
    display_name: name,
    gender,
    locale: "en-US",
  });
  const VOICES = {
    voices: [
      voice("voice-tom", "Tom Hardy", "male"),
      voice("voice-nora", "Nora", "female"),
      voice("geffen_32", "Geffen", "male"),
      voice("dominic_32", "Dominic", "male"),
    ],
    has_more: false,
  };
  const voiceList = () => new Response(JSON.stringify(VOICES), { status: 200 });

  beforeEach(() => resetVoicesCache());

  /** The fake GitHub, with a Speechify voice list beside it and a key to read it with. */
  function voiced(reply: () => Promise<Response> | Response = voiceList) {
    const { deps, github, logs } = setup();
    github.on(RUNS, { json: { workflow_runs: [] } });
    github.on(DISPATCH, { json: { workflow_run_id: 7 } });
    const calls: string[] = [];
    const speechify: Array<{ url: string; init: RequestInit | undefined }> = [];
    deps.fetch = async (url, init) => {
      if (url.startsWith(SPEECHIFY_VOICES_URL)) {
        calls.push("speechify");
        speechify.push({ url, init });
        return reply();
      }
      calls.push(`${init?.method ?? "GET"} github`);
      return github.fetch(url, init);
    };
    deps.env = { ...deps.env, SPEECHIFY_API_KEY: SPEECHIFY_KEY };
    return { deps, github, logs, calls, speechify };
  }

  /** The request podcast.yml was given. */
  const sent = (github: ReturnType<typeof setup>["github"]): Record<string, unknown> => {
    const dispatch = github.requests.find((request) => request.method === "POST");
    if (!dispatch) throw new Error("podcast.yml was not dispatched");
    return JSON.parse((dispatch.body as { inputs: { request: string } }).inputs.request);
  };

  it("names a new discussion's hosts after its voices, looked up beside the GitHub calls", async () => {
    const { deps, github, logs, calls, speechify } = voiced();
    const request = { ...REQUEST, voice_id: "voice-tom", voice_id_b: "voice-nora" };
    const result = await handlePodcast(input(body({ request })), deps);
    expect(result.status).toBe(202);
    const expected = hostNamesFor(
      { id: "voice-tom", name: "Tom Hardy", gender: "male" },
      { id: "voice-nora", name: "Nora", gender: "female" },
    );
    // "Tom Hardy" is not one given name, so the lead takes a man's name from the pool.
    expect(HOST_NAME_POOLS.male).toContain(expected.a);
    expect(expected.b).toBe("Nora");
    expect(sent(github)).toEqual({ ...request, host_names: expected });
    expect(calls).toEqual(["speechify", "GET github", "POST github"]);
    expect(new Headers(speechify[0]?.init?.headers).get("authorization")).toBe(
      `Bearer ${SPEECHIFY_KEY}`,
    );
    expect(speechify[0]?.url).not.toContain(SPEECHIFY_KEY);
    expect(JSON.stringify(github.requests)).not.toContain(SPEECHIFY_KEY);
    expect(logs).toEqual([]);
  });

  it("puts its own names over the browser's, and sends none for a readout", async () => {
    const forged = { a: "Mallory", b: "Eve" };
    const discussion = voiced();
    await handlePodcast(
      input(body({ request: { ...REQUEST, host_names: forged } })),
      discussion.deps,
    );
    expect(sent(discussion.github).host_names).toEqual({ a: "Geffen", b: "Dominic" });

    const readout = voiced();
    const request = { ...REQUEST, format: "readout", host_names: forged };
    expect((await handlePodcast(input(body({ request })), readout.deps)).status).toBe(202);
    expect(sent(readout.github)).toEqual({ ...REQUEST, format: "readout" });
    expect(readout.speechify).toHaveLength(0);
  });

  it("still dispatches, without names, when the voice list fails, and logs only the kind", async () => {
    const answered = voiced(
      () => new Response(JSON.stringify({ message: `bad ${SPEECHIFY_KEY}` }), { status: 401 }),
    );
    expect((await handlePodcast(input(body()), answered.deps)).status).toBe(202);
    expect(sent(answered.github)).toEqual(REQUEST);
    expect(answered.logs).toEqual(["Speechify answered HTTP 401 for the voice list"]);

    resetVoicesCache();
    const thrown = voiced(() => {
      throw new Error(`socket closed while sending ${SPEECHIFY_KEY}`);
    });
    expect((await handlePodcast(input(body()), thrown.deps)).status).toBe(202);
    expect(sent(thrown.github)).toEqual(REQUEST);
    expect(thrown.logs).toEqual(["The voice list could not be read (Error)"]);
  });

  it("does not read the voice list for a delete or a regenerate", async () => {
    for (const bodyText of [del(), regen()]) {
      const { deps, speechify } = voiced();
      expect((await handlePodcast(input(bodyText), deps)).status).toBe(202);
      expect(speechify).toHaveLength(0);
    }
  });
});
