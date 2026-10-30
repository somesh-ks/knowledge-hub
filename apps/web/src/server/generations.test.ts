import { beforeEach, describe, expect, it } from "vitest";
import { createFakeGitHub, REPO, runJson, stepJson } from "../testing/fakeGitHub";
import { cancelTokenFor } from "./cancelToken";
import { handleCancel, handleGenerations, parseCancelBody } from "./generations";
import { resetTimingsCaches } from "./status";

const TOKEN = "github_pat_secret_value_123456";
const env = { GITHUB_SINGULARITY_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO };
const ORIGIN = "https://news.example";

beforeEach(resetTimingsCaches);

/** A fake with the two workflows' run lists and the jobs of the runs in them. */
function setup(podcasts: unknown[] = [], episodes: unknown[] = []) {
  const github = createFakeGitHub();
  github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: podcasts } });
  github.on("GET /actions/workflows/podcast.yml/runs", { json: { workflow_runs: episodes } });
  return github;
}

describe("the list of generations", () => {
  it("lists the runs that have not finished, oldest first, from both workflows", async () => {
    const github = setup(
      [
        runJson({
          id: 11,
          status: "in_progress",
          created_at: "2026-10-28T06:00:00Z",
          display_title: "run",
        }),
        runJson({
          id: 10,
          status: "completed",
          conclusion: "success",
          created_at: "2026-10-28T05:00:00Z",
        }),
      ],
      [
        runJson({
          id: 12,
          path: ".github/workflows/podcast.yml",
          status: "queued",
          created_at: "2026-10-28T05:30:00Z",
        }),
      ],
    );
    github.on("GET /actions/runs/11/jobs", {
      json: { jobs: [{ steps: [stepJson("Write", 4, "in_progress")] }] },
    });
    const result = await handleGenerations({ env, fetch: github.fetch });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      generations: [
        { run_id: 12, what: "episode", state: "queued", stage: 0 },
        { run_id: 11, what: "briefing", state: "running", stage: 3, label: "Writing the podcast" },
      ],
    });
  });

  // A delete and a dry run are runs of run.yml, but nobody waits for a briefing from them, and the
  // schedule's Daily and Weekly are made in the background (D217).
  it("leaves out a delete, a dry run and the schedule's own runs", async () => {
    const github = setup([
      runJson({ id: 21, status: "in_progress", display_title: "delete 2026-10-27" }),
      runJson({ id: 22, status: "in_progress", display_title: "dry run scheduled" }),
      runJson({ id: 23, status: "in_progress", display_title: "daily 2026-10-27" }),
      runJson({ id: 24, status: "in_progress", display_title: "weekly 2026-10-25" }),
      runJson({ id: 25, status: "in_progress", display_title: "scheduled" }),
    ]);
    const result = await handleGenerations({ env, fetch: github.fetch });
    expect(result.body).toEqual({ generations: [] });
  });

  // The queue names a row for what it is (lib/queueNames.ts) and shows only what a person asked for.
  it("tells a Catch up from a regeneration, and names the podcast a regeneration replaces", async () => {
    const episodes = [
      runJson({
        id: 41,
        path: ".github/workflows/podcast.yml",
        status: "in_progress",
        display_title: "episode",
        created_at: "2026-10-28T05:00:00Z",
      }),
      runJson({
        id: 42,
        path: ".github/workflows/podcast.yml",
        status: "in_progress",
        display_title: "regenerate ep-20261027-1405",
        created_at: "2026-10-28T05:10:00Z",
      }),
      runJson({
        id: 43,
        path: ".github/workflows/podcast.yml",
        status: "in_progress",
        display_title: "regenerate not an id",
        created_at: "2026-10-28T05:20:00Z",
      }),
      runJson({
        id: 44,
        path: ".github/workflows/podcast.yml",
        status: "in_progress",
        display_title: "delete ep-20261027-1405",
        created_at: "2026-10-28T05:30:00Z",
      }),
    ];
    const github = setup(
      [
        runJson({
          id: 45,
          status: "in_progress",
          display_title: "regenerate 2026-10-26",
          created_at: "2026-10-28T04:00:00Z",
        }),
      ],
      episodes,
    );
    for (const id of [41, 42, 43, 45]) {
      github.on(`GET /actions/runs/${id}/jobs`, { json: { jobs: [{ steps: [] }] } });
    }
    const result = await handleGenerations({ env, fetch: github.fetch });
    const rows = (
      result.body as { generations: { run_id: number; kind: string; target: string | null }[] }
    ).generations;
    expect(rows.map(({ run_id, kind, target }) => [run_id, kind, target])).toEqual([
      [45, "regenerate", "2026-10-26"],
      [41, "catch_up", null],
      [42, "regenerate", "ep-20261027-1405"],
      [43, "regenerate", null],
    ]);
  });

  it("leaves out a run that is not ours, and answers 503 without leaking when GitHub fails", async () => {
    const foreign = setup([
      runJson({ id: 31, status: "in_progress", repository: { full_name: "evil/repo" } }),
    ]);
    expect((await handleGenerations({ env, fetch: foreign.fetch })).body).toEqual({
      generations: [],
    });

    const broken = createFakeGitHub();
    broken.on("GET /actions/workflows/run.yml/runs", {
      status: 500,
      json: { message: "internal details" },
    });
    const logs: string[] = [];
    const result = await handleGenerations({ env, fetch: broken.fetch, log: (m) => logs.push(m) });
    expect(result).toEqual({ status: 503, body: { error: "unavailable" } });
    expect(JSON.stringify(result) + logs.join("")).not.toContain(TOKEN);
  });
});

describe("cancelling a generation", () => {
  const ask = (body: string, origin: string | null = ORIGIN) => ({
    bodyText: body,
    origin,
    expectedOrigin: ORIGIN,
  });
  /** The body the starter of run 4242 sends: its id and the token the start handed back. */
  const owned = (runId = 4242, token = cancelTokenFor(TOKEN, 4242)) =>
    JSON.stringify({ run_id: runId, cancel_token: token });

  it("reads a run id from the body and nothing else", () => {
    expect(parseCancelBody('{"run_id": 4242}')).toBe(4242);
    for (const bad of [
      "",
      "[]",
      "null",
      '{"run_id":"4242"}',
      '{"run_id":0}',
      '{"run_id":4.2}',
      "{",
    ]) {
      expect(parseCancelBody(bad)).toBeNull();
    }
  });

  it("asks GitHub to cancel an active run of ours, and says so", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", { json: runJson({ status: "in_progress" }) });
    github.on("POST /actions/runs/4242/cancel", { status: 202, json: {} });
    const result = await handleCancel(ask(owned()), { env, fetch: github.fetch });
    expect(result).toEqual({ status: 202, body: { run_id: 4242, cancelled: true } });
    expect(github.requests.filter((r) => r.path.endsWith("/cancel"))).toHaveLength(1);
  });

  it("refuses another site, a bad body and a run that is not ours, and cancels none of them", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", {
      json: runJson({ path: ".github/workflows/health.yml" }),
    });
    github.on("POST /actions/runs/4242/cancel", { status: 202, json: {} });
    const refused = [
      await handleCancel(ask(owned(), "https://evil.example"), {
        env,
        fetch: github.fetch,
      }),
      await handleCancel(ask("not json"), { env, fetch: github.fetch }),
      await handleCancel(ask(owned()), { env, fetch: github.fetch }),
    ];
    expect(refused.map((r) => r.status)).toEqual([400, 400, 404]);
    expect(github.requests.some((r) => r.path.endsWith("/cancel"))).toBe(false);
  });

  // The route had no auth (D201): a request with no Origin, or a forged one, stopped any run of ours,
  // the schedule's included. Only the starter holds a run's token, so this is the check that closes it.
  it("refuses a missing, a wrong and another run's token before the cap or GitHub", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", { json: runJson({ status: "in_progress" }) });
    github.on("POST /actions/runs/4242/cancel", { status: 202, json: {} });
    let taken = 0;
    const burst = async () => {
      taken += 1;
      return 0;
    };
    const refused = [
      await handleCancel(ask('{"run_id":4242}'), { env, fetch: github.fetch, burst }),
      await handleCancel(ask(owned(4242, "0".repeat(64))), { env, fetch: github.fetch, burst }),
      await handleCancel(ask(owned(4242, "short")), { env, fetch: github.fetch, burst }),
      await handleCancel(ask(owned(4242, cancelTokenFor(TOKEN, 4243))), {
        env,
        fetch: github.fetch,
        burst,
      }),
      await handleCancel(ask(owned(4242, cancelTokenFor("another-secret", 4242))), {
        env,
        fetch: github.fetch,
        burst,
      }),
    ];
    expect(refused.map((r) => [r.status, "error" in r.body ? r.body.error : null])).toEqual(
      Array(5).fill([403, "forbidden"]),
    );
    expect(taken).toBe(0);
    expect(github.requests).toHaveLength(0);
  });

  it("says a run that has ended is finished, and does not call cancel", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", {
      json: runJson({ status: "completed", conclusion: "success" }),
    });
    github.on("POST /actions/runs/4242/cancel", { status: 202, json: {} });
    const result = await handleCancel(ask(owned()), { env, fetch: github.fetch });
    expect(result).toEqual({ status: 409, body: { error: "already_finished" } });
    expect(github.requests.some((r) => r.path.endsWith("/cancel"))).toBe(false);
  });

  it("takes the burst cap only after the checks, and answers a full minute with its wait", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", { json: runJson({ status: "in_progress" }) });
    let taken = 0;
    const burst = async () => {
      taken += 1;
      return 30;
    };
    await handleCancel(ask(owned(), "https://evil.example"), {
      env,
      fetch: github.fetch,
      burst,
    });
    expect(taken).toBe(0);
    const result = await handleCancel(ask(owned()), { env, fetch: github.fetch, burst });
    expect(result).toMatchObject({ status: 429, body: { error: "cooldown", retry_after_s: 30 } });
    expect(github.requests).toHaveLength(0);
  });

  it("answers 503 when GitHub refuses, without its words", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", { json: runJson({ status: "in_progress" }) });
    github.on("POST /actions/runs/4242/cancel", {
      status: 403,
      json: { message: "Resource not accessible" },
    });
    const logs: string[] = [];
    const result = await handleCancel(ask(owned()), {
      env,
      fetch: github.fetch,
      log: (m) => logs.push(m),
    });
    expect(result).toEqual({ status: 503, body: { error: "unavailable" } });
    expect(JSON.stringify(result) + logs.join("")).not.toContain("Resource not accessible");
  });
});
