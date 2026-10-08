import { describe, expect, it } from "vitest";
import { createFakeGitHub, REPO, runJson, stepJson } from "../testing/fakeGitHub";
import { readServerConfig } from "./config";
import { createGitHubClient, GitHubError } from "./github";

const parsedConfig = readServerConfig({
  GITHUB_DISPATCH_TOKEN: "github_pat_secret_value_123456",
  GITHUB_REPOSITORY: REPO,
  GENERATE_PASSPHRASE_HASH: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
});
if (!parsedConfig) throw new Error("test config");
const config = parsedConfig;

function setup() {
  const github = createFakeGitHub();
  return { github, client: createGitHubClient(config, github.fetch) };
}

describe("createGitHubClient", () => {
  it("sends the token, the API version and a user agent on every request", async () => {
    const { github, client } = setup();
    github.on("GET /actions/workflows/run.yml/runs", { json: { workflow_runs: [] } });
    await client.listDispatchRuns();
    const [request] = github.requests;
    expect(request?.headers.authorization).toBe("Bearer github_pat_secret_value_123456");
    expect(request?.headers["x-github-api-version"]).toBe("2022-11-28");
    expect(request?.headers["user-agent"]).toBe("dispatch-site");
  });

  it("lists only workflow_dispatch runs of run.yml on main", async () => {
    const { github, client } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      json: { workflow_runs: [runJson({ id: 1 }), runJson({ id: 2 })] },
    });
    const runs = await client.listDispatchRuns();
    expect(runs.map((run) => run.id)).toEqual([1, 2]);
    expect(github.requests[0]?.path).toContain("event=workflow_dispatch");
    expect(github.requests[0]?.path).toContain("branch=main");
  });

  it("drops malformed runs and keeps only the fields it uses", async () => {
    const { github, client } = setup();
    github.on("GET /actions/workflows/run.yml/runs", {
      json: {
        workflow_runs: [{ id: "x" }, null, runJson({ id: 5, head_commit: { message: "secret" } })],
      },
    });
    const runs = await client.listDispatchRuns();
    expect(runs).toHaveLength(1);
    expect(Object.keys(runs[0] ?? {}).sort()).toEqual([
      "conclusion",
      "createdAt",
      "event",
      "id",
      "path",
      "repositoryFullName",
      "startedAt",
      "status",
    ]);
  });

  it("dispatches run.yml on main with fixed inputs and asks for the run id", async () => {
    const { github, client } = setup();
    github.on("POST /actions/workflows/run.yml/dispatches", { json: { workflow_run_id: 987 } });
    expect(await client.dispatch({ mode: "on-demand" })).toBe(987);
    expect(github.requests[0]?.body).toEqual({
      ref: "main",
      inputs: { mode: "on-demand" },
      return_run_details: true,
    });
  });

  it("returns null when GitHub answers 204 with no run id", async () => {
    const { github, client } = setup();
    github.on("POST /actions/workflows/run.yml/dispatches", { status: 204 });
    expect(await client.dispatch({ mode: "on-demand" })).toBeNull();
  });

  it("fails with the status only, never a body, when GitHub refuses", async () => {
    const { github, client } = setup();
    github.on("POST /actions/workflows/run.yml/dispatches", {
      status: 403,
      json: { message: "Resource not accessible by personal access token" },
    });
    await expect(client.dispatch({ mode: "on-demand" })).rejects.toThrow(GitHubError);
    await expect(client.dispatch({ mode: "on-demand" })).rejects.toThrow("GitHub answered 403");
  });

  it("returns null for a run that does not exist", async () => {
    const { client } = setup();
    expect(await client.getRun(1)).toBeNull();
  });

  it("flattens job steps in order", async () => {
    const { github, client } = setup();
    github.on("GET /actions/runs/9/jobs", {
      json: {
        jobs: [
          {
            steps: [
              stepJson("Gate", 1, "completed", "success"),
              stepJson("Fetch", 2, "in_progress"),
            ],
          },
          { steps: [stepJson("Judge", 1, "queued")] },
        ],
      },
    });
    expect((await client.listSteps(9)).map((step) => step.name)).toEqual([
      "Gate",
      "Fetch",
      "Judge",
    ]);
  });

  it("reads a file as raw text and returns null when it is missing", async () => {
    const { github, client } = setup();
    github.on("GET /contents/state/last-run.json", { text: '{"version":1}' });
    expect(await client.readFile("state/last-run.json", "main")).toBe('{"version":1}');
    expect(github.requests[0]?.headers.accept).toBe("application/vnd.github.raw+json");
    expect(await client.readFile("state/missing.json", "main")).toBeNull();
  });

  it("lists the runs of any plain workflow file, and keeps run.yml's own listing the same", async () => {
    const { github, client } = setup();
    github.on("GET /actions/workflows/podcast.yml/runs", {
      json: { workflow_runs: [runJson({ id: 7 })] },
    });
    const runs = await client.listWorkflowFileRuns("podcast.yml");
    expect(runs.map((run) => run.id)).toEqual([7]);
    expect(github.requests[0]?.path).toContain("event=workflow_dispatch");
    expect(github.requests[0]?.path).toContain("branch=main");
  });

  it("dispatches a named workflow file on main and returns the run id", async () => {
    const { github, client } = setup();
    github.on("POST /actions/workflows/podcast.yml/dispatches", { json: { workflow_run_id: 55 } });
    expect(await client.dispatchWorkflowFile("podcast.yml", { request: "{}" })).toBe(55);
    expect(github.requests[0]?.body).toEqual({
      ref: "main",
      inputs: { request: "{}" },
      return_run_details: true,
    });
  });

  it("returns null when GitHub dispatches a named file without naming the run", async () => {
    const { github, client } = setup();
    github.on("POST /actions/workflows/podcast.yml/dispatches", { status: 204 });
    expect(await client.dispatchWorkflowFile("podcast.yml", {})).toBeNull();
  });

  it("refuses a workflow name that is not a plain file name, without calling GitHub", async () => {
    const { github, client } = setup();
    for (const bad of ["../run.yml", "run.yml/../x", "podcast", "a b.yml", "podcast.yml?x=1", ""]) {
      await expect(client.dispatchWorkflowFile(bad, {})).rejects.toThrow(
        "not a workflow file name",
      );
      await expect(client.listWorkflowFileRuns(bad)).rejects.toThrow("not a workflow file name");
    }
    expect(github.requests).toHaveLength(0);
  });
});
