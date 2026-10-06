import type { ServerConfig } from "./config";

/**
 * A narrow GitHub REST client for the Generate flow: list and read workflow runs and jobs, dispatch
 * run.yml, and read one file. It takes `fetch` as a parameter so tests never touch the network, and it
 * returns only the fields the flow uses, so nothing else from GitHub can flow into a response.
 */

export const WORKFLOW_FILE = "run.yml";
const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 8000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An HTTP failure from GitHub. The message names the status only, never a body or a header. */
export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GitHub answered ${status}`);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface WorkflowRun {
  id: number;
  event: string;
  path: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  repositoryFullName: string;
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRun(value: unknown): WorkflowRun | null {
  if (!isRecord(value)) return null;
  const repository = isRecord(value.repository) ? asString(value.repository.full_name) : null;
  const createdAt = asString(value.created_at);
  if (typeof value.id !== "number" || !createdAt) return null;
  return {
    id: value.id,
    event: asString(value.event) ?? "",
    path: asString(value.path) ?? "",
    status: asString(value.status) ?? "",
    conclusion: asString(value.conclusion),
    createdAt,
    startedAt: asString(value.run_started_at),
    repositoryFullName: repository ?? "",
  };
}

export interface GitHubClient {
  /** Recent workflow_dispatch runs of run.yml on main, newest first. */
  listDispatchRuns(): Promise<WorkflowRun[]>;
  /** Starts run.yml on main. Returns the new run's id, or null when GitHub did not report one. */
  dispatch(inputs: Record<string, string>): Promise<number | null>;
  getRun(runId: number): Promise<WorkflowRun | null>;
  listSteps(runId: number): Promise<WorkflowStep[]>;
  /** The text of a file at `ref`, or null when it does not exist. */
  readFile(path: string, ref: string): Promise<string | null>;
}

export function createGitHubClient(config: ServerConfig, fetchImpl: FetchLike): GitHubClient {
  const base = `${API}/repos/${config.owner}/${config.repo}`;

  async function request(path: string, init: RequestInit = {}, accept?: string): Promise<Response> {
    return fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "dispatch-site",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function json(path: string): Promise<unknown> {
    const response = await request(path);
    if (!response.ok) throw new GitHubError(response.status);
    return response.json();
  }

  return {
    async listDispatchRuns() {
      const body = await json(
        `/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=main&per_page=30`,
      );
      const runs = isRecord(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
      return runs.map(parseRun).filter((run): run is WorkflowRun => run !== null);
    },

    async dispatch(inputs) {
      const response = await request(`/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        method: "POST",
        // return_run_details asks GitHub to answer 200 with the run id instead of 204 with nothing.
        body: JSON.stringify({ ref: "main", inputs, return_run_details: true }),
      });
      if (!response.ok) throw new GitHubError(response.status);
      if (response.status === 204) return null;
      const body: unknown = await response.json().catch(() => null);
      return isRecord(body) && typeof body.workflow_run_id === "number"
        ? body.workflow_run_id
        : null;
    },

    async getRun(runId) {
      const response = await request(`/actions/runs/${runId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new GitHubError(response.status);
      return parseRun(await response.json());
    },

    async listSteps(runId) {
      const body = await json(`/actions/runs/${runId}/jobs?per_page=100`);
      const jobs = isRecord(body) && Array.isArray(body.jobs) ? body.jobs : [];
      const steps: WorkflowStep[] = [];
      for (const job of jobs) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue;
        for (const step of job.steps) {
          if (!isRecord(step)) continue;
          const name = asString(step.name);
          if (!name || typeof step.number !== "number") continue;
          steps.push({
            name,
            status: asString(step.status) ?? "",
            conclusion: asString(step.conclusion),
            number: step.number,
          });
        }
      }
      return steps;
    },

    async readFile(path, ref) {
      const response = await request(
        `/contents/${path}?ref=${encodeURIComponent(ref)}`,
        {},
        "application/vnd.github.raw+json",
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new GitHubError(response.status);
      return response.text();
    },
  };
}
