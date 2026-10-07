import { describe, expect, it } from "vitest";
import { createFakeGitHub, REPO, runJson, stepJson } from "../testing/fakeGitHub";
import { readServerConfig } from "./config";
import { WORKFLOW_FILE } from "./github";
import {
  currentStep,
  failedStep,
  handleStatus,
  isOurRun,
  parseOnDemandRecord,
  parseRunId,
  runUrlFor,
  STATUS_CACHE_CONTROL,
} from "./status";

const TOKEN = "github_pat_secret_value_123456";
const env = {
  GITHUB_DISPATCH_TOKEN: TOKEN,
  GITHUB_REPOSITORY: REPO,
  GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
};
const config = readServerConfig(env);
if (!config) throw new Error("test config");

function setup(runOverrides: Record<string, unknown> = {}, steps: unknown[] = []) {
  const github = createFakeGitHub();
  github.on("GET /actions/runs/4242", { json: runJson(runOverrides) });
  github.on("GET /actions/runs/4242/jobs", { json: { jobs: [{ steps }] } });
  return github;
}

const record = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    on_demand: {
      at: "2026-10-07T05:03:00.000Z",
      outcome: "published",
      digest_id: "2026-10-07",
      items: 12,
      ...overrides,
    },
  });

describe("parseRunId", () => {
  it("accepts a plain positive integer", () => {
    expect(parseRunId("4242")).toBe(4242);
  });

  it("rejects everything else", () => {
    for (const bad of [
      null,
      "",
      "0",
      "-1",
      "01",
      "4.2",
      "4242 ",
      "abc",
      "1e3",
      "99999999999999999",
      "4242/jobs",
      "4242?x=1",
    ]) {
      expect(parseRunId(bad)).toBeNull();
    }
  });
});

describe("isOurRun", () => {
  const ours = {
    id: 1,
    event: "workflow_dispatch",
    path: ".github/workflows/run.yml",
    status: "queued",
    conclusion: null,
    createdAt: "2026-10-07T05:00:00Z",
    startedAt: null,
    repositoryFullName: REPO,
  };

  it("accepts a dispatch run of run.yml in this repository", () => {
    expect(isOurRun(ours, config)).toBe(true);
    expect(isOurRun({ ...ours, path: ".github/workflows/run.yml@refs/heads/main" }, config)).toBe(
      true,
    );
    expect(isOurRun({ ...ours, repositoryFullName: REPO.toUpperCase() }, config)).toBe(true);
  });

  it("rejects another workflow, another event or another repository", () => {
    expect(isOurRun({ ...ours, path: ".github/workflows/audio.yml" }, config)).toBe(false);
    expect(isOurRun({ ...ours, path: ".github/workflows/run.yml.bak" }, config)).toBe(false);
    expect(isOurRun({ ...ours, event: "schedule" }, config)).toBe(false);
    expect(isOurRun({ ...ours, event: "push" }, config)).toBe(false);
    expect(isOurRun({ ...ours, repositoryFullName: "someone/else" }, config)).toBe(false);
  });

  it("names the workflow file it looks for", () => {
    expect(WORKFLOW_FILE).toBe("run.yml");
  });
});

describe("currentStep", () => {
  const step = stepJson;
  const asSteps = (...entries: Array<Record<string, unknown>>) =>
    entries.map((entry) => ({
      name: String(entry.name),
      number: Number(entry.number),
      status: String(entry.status),
      conclusion: (entry.conclusion as string | null) ?? null,
    }));

  it("is waiting before any named step has started", () => {
    expect(currentStep([])).toBe("waiting");
    expect(currentStep(asSteps(step("Set up job", 1, "completed", "success")))).toBe("waiting");
  });

  it("follows the step that is in progress", () => {
    expect(
      currentStep(
        asSteps(
          step("Set up job", 1, "completed", "success"),
          step("Gate", 2, "completed", "success"),
          step("Fetch", 3, "completed", "success"),
          step("Judge", 4, "in_progress"),
          step("Write", 5, "pending"),
        ),
      ),
    ).toBe("judging");
  });

  it("holds the latest finished step between steps", () => {
    expect(
      currentStep(
        asSteps(
          step("Gate", 1, "completed", "success"),
          step("Fetch", 2, "completed", "success"),
          step("Judge", 3, "pending"),
        ),
      ),
    ).toBe("reading");
  });

  it("maps Commit and Audio both to publishing", () => {
    expect(currentStep(asSteps(step("Commit", 6, "in_progress")))).toBe("publishing");
    expect(currentStep(asSteps(step("Audio", 7, "in_progress")))).toBe("publishing");
    expect(currentStep(asSteps(step("Validate", 5, "in_progress")))).toBe("checking");
  });

  it("ignores step names it does not know", () => {
    expect(currentStep(asSteps(step("Checkout", 1, "in_progress")))).toBe("waiting");
  });
});

describe("failedStep", () => {
  it("names the step a run stopped at", () => {
    const steps = [
      { name: "Gate", number: 1, status: "completed", conclusion: "success" },
      { name: "Write", number: 2, status: "completed", conclusion: "failure" },
    ];
    expect(failedStep(steps)).toBe("writing");
  });

  it("is null when no named step failed", () => {
    expect(
      failedStep([{ name: "Set up job", number: 1, status: "completed", conclusion: "failure" }]),
    ).toBeNull();
    expect(failedStep([])).toBeNull();
  });
});

describe("parseOnDemandRecord", () => {
  it("reads the on-demand record", () => {
    expect(parseOnDemandRecord(record())).toEqual({
      at: "2026-10-07T05:03:00.000Z",
      outcome: "published",
      digestId: "2026-10-07",
    });
  });

  it("drops a malformed digest id and rejects unknown outcomes", () => {
    expect(parseOnDemandRecord(record({ digest_id: "../../x" }))?.digestId).toBeNull();
    expect(parseOnDemandRecord(record({ outcome: "mystery" }))).toBeNull();
    expect(parseOnDemandRecord(record({ at: "yesterday" }))).toBeNull();
  });

  it("is null for anything that is not the expected file", () => {
    for (const bad of ["", "not json", "null", "{}", '{"on_demand":null}', '{"regular":{}}']) {
      expect(parseOnDemandRecord(bad)).toBeNull();
    }
  });
});

describe("handleStatus", () => {
  it("answers 503 when the site is not configured", async () => {
    const github = setup();
    expect((await handleStatus("4242", { env: {}, fetch: github.fetch })).status).toBe(503);
    expect(github.requests).toHaveLength(0);
  });

  it("answers 400 for a run parameter that is not a number", async () => {
    const github = setup();
    for (const bad of [null, "", "abc", "1; drop", "4242/../x"]) {
      expect((await handleStatus(bad, { env, fetch: github.fetch })).status).toBe(400);
    }
    expect(github.requests).toHaveLength(0);
  });

  it("answers 404 for a run that does not exist", async () => {
    const github = createFakeGitHub();
    const result = await handleStatus("999", { env, fetch: github.fetch });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("answers 404 for a run of another workflow, without reading its jobs", async () => {
    const github = setup({ path: ".github/workflows/audio.yml" });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
    expect(github.requests.some((request) => request.path.includes("/jobs"))).toBe(false);
  });

  it("answers 404 for a scheduled run of run.yml", async () => {
    const github = setup({ event: "schedule" });
    expect((await handleStatus("4242", { env, fetch: github.fetch })).status).toBe(404);
  });

  it("answers 404 for a run in another repository", async () => {
    const github = setup({ repository: { full_name: "someone/else" } });
    expect((await handleStatus("4242", { env, fetch: github.fetch })).status).toBe(404);
  });

  it("gives foreign and missing runs the same answer, so it reveals nothing", async () => {
    const foreign = await handleStatus("4242", { env, fetch: setup({ event: "push" }).fetch });
    const missing = await handleStatus("4242", { env, fetch: createFakeGitHub().fetch });
    expect(foreign).toEqual(missing);
  });

  it("reports a queued run as waiting", async () => {
    const github = setup({ status: "queued" });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ run_id: 4242, state: "queued", step: "waiting" });
    expect(result.headers).toEqual({ "Cache-Control": STATUS_CACHE_CONTROL });
  });

  it("reports the step of a running run", async () => {
    const github = setup({}, [
      stepJson("Gate", 1, "completed", "success"),
      stepJson("Fetch", 2, "completed", "success"),
      stepJson("Judge", 3, "in_progress"),
    ]);
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toEqual({ run_id: 4242, state: "running", step: "judging" });
  });

  it("reports a published digest from the on-demand record", async () => {
    const github = setup({ status: "completed", conclusion: "success" });
    github.on("GET /contents/state/last-run.json", { text: record() });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toEqual({
      run_id: 4242,
      state: "completed",
      step: null,
      outcome: "published",
      digest_id: "2026-10-07",
    });
    expect(github.requests.find((request) => request.path.includes("contents"))?.path).toContain(
      "ref=main",
    );
  });

  it("reports nothing without a digest id", async () => {
    const github = setup({ status: "completed", conclusion: "success" });
    github.on("GET /contents/state/last-run.json", {
      text: record({ outcome: "nothing", digest_id: undefined, items: 0 }),
    });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toEqual({
      run_id: 4242,
      state: "completed",
      step: null,
      outcome: "nothing",
    });
  });

  it("reports a failed conclusion with the failing step and a link to the run", async () => {
    const github = setup({ status: "completed", conclusion: "failure" }, [
      stepJson("Gate", 1, "completed", "success"),
      stepJson("Write", 2, "completed", "failure"),
    ]);
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toEqual({
      run_id: 4242,
      state: "completed",
      step: "writing",
      outcome: "failed",
      run_url: runUrlFor(config, 4242),
    });
    expect(github.requests.some((request) => request.path.includes("contents"))).toBe(false);
  });

  it("reads the record when only the nested audio step failed, because the briefing is live", async () => {
    const github = setup({ status: "completed", conclusion: "failure" }, [
      stepJson("Commit", 1, "completed", "success"),
      stepJson("Audio", 2, "completed", "failure"),
    ]);
    github.on("GET /contents/state/last-run.json", { text: record() });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toEqual({
      run_id: 4242,
      state: "completed",
      step: null,
      outcome: "published",
      digest_id: "2026-10-07",
    });
  });

  it("still reports failed when a pipeline step failed alongside audio", async () => {
    const github = setup({ status: "completed", conclusion: "failure" }, [
      stepJson("Write", 1, "completed", "failure"),
      stepJson("Audio", 2, "completed", "failure"),
    ]);
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toMatchObject({ outcome: "failed", step: "writing" });
  });

  it("treats a success with no fresh record as failed rather than guessing", async () => {
    const github = setup({ status: "completed", conclusion: "success" });
    github.on("GET /contents/state/last-run.json", {
      text: record({ at: "2026-10-01T05:00:00.000Z" }),
    });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(result.body).toMatchObject({ outcome: "failed", step: null });
  });

  it("builds the run link itself instead of trusting GitHub's field", async () => {
    const github = setup({
      status: "completed",
      conclusion: "cancelled",
      html_url: "https://evil.example/phish",
    });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    expect(JSON.stringify(result.body)).not.toContain("evil.example");
    expect(result.body).toMatchObject({ run_url: `https://github.com/${REPO}/actions/runs/4242` });
  });

  it("answers 503 with a generic body when GitHub fails", async () => {
    const github = createFakeGitHub();
    github.on("GET /actions/runs/4242", { status: 500, json: { message: "internal details" } });
    const logs: string[] = [];
    const result = await handleStatus("4242", {
      env,
      fetch: github.fetch,
      log: (m) => logs.push(m),
    });
    expect(result).toEqual({ status: 503, body: { error: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("internal details");
    expect(logs.join("")).not.toContain(TOKEN);
  });

  it("returns only the fields of the contract, whatever GitHub sends", async () => {
    const github = setup(
      {
        status: "completed",
        conclusion: "success",
        head_commit: { message: "private" },
        actor: { login: "x" },
      },
      [
        {
          name: "Gate",
          number: 1,
          status: "completed",
          conclusion: "success",
          started_at: "x",
          secret: "y",
        },
      ],
    );
    github.on("GET /contents/state/last-run.json", { text: record() });
    const result = await handleStatus("4242", { env, fetch: github.fetch });
    const allowed = ["run_id", "state", "step", "outcome", "digest_id", "run_url"];
    expect(Object.keys(result.body).every((key) => allowed.includes(key))).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/private|login|secret/);
  });
});
