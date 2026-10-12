import type { ServerConfig } from "./config";

/**
 * A narrow GitHub REST client for the Generate flow: list and read workflow runs and jobs, dispatch
 * run.yml, and read one file. It takes `fetch` as a parameter so tests never touch the network, and it
 * returns only the fields the flow uses, so nothing else from GitHub can flow into a response.
 */

export const WORKFLOW_FILE = "run.yml";
/** The workflow that writes a podcast episode (POST /api/podcast). */
export const PODCAST_WORKFLOW_FILE = "podcast.yml";
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

/** A workflow file name as GitHub takes it in a path: a plain name, never a directory. */
const WORKFLOW_FILE_NAME = /^[A-Za-z0-9_-]+.ya?ml$/;

export interface GitHubClient {
  /** Recent workflow_dispatch runs of run.yml on main, newest first. */
  listDispatchRuns(): Promise<WorkflowRun[]>;
  /** Starts run.yml on main. Returns the new run's id, or null when GitHub did not report one. */
  dispatch(inputs: Record<string, string>): Promise<number | null>;
  /** Recent workflow_dispatch runs of the named workflow file on main, newest first. */
  listWorkflowFileRuns(file: string): Promise<WorkflowRun[]>;
  /**
   * Starts the named workflow file (for example "podcast.yml") on main with these inputs. Returns the
   * new run's id, or null when GitHub did not report one. Throws for a name that is not a plain
   * workflow file name.
   */
  dispatchWorkflowFile(file: string, inputs: Record<string, string>): Promise<number | null>;
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

  function workflowPath(file: string): string {
    if (!WORKFLOW_FILE_NAME.test(file)) throw new Error("not a workflow file name");
    return `/actions/workflows/${file}`;
  }

  async function listRuns(file: string): Promise<WorkflowRun[]> {
    const body = await json(
      `${workflowPath(file)}/runs?event=workflow_dispatch&branch=main&per_page=30`,
    );
    const runs = isRecord(body) && Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
    return runs.map(parseRun).filter((run): run is WorkflowRun => run !== null);
  }

  async function dispatchFile(
    file: string,
    inputs: Record<string, string>,
  ): Promise<number | null> {
    const response = await request(`${workflowPath(file)}/dispatches`, {
      method: "POST",
      // return_run_details asks GitHub to answer 200 with the run id instead of 204 with nothing.
      body: JSON.stringify({ ref: "main", inputs, return_run_details: true }),
    });
    if (!response.ok) throw new GitHubError(response.status);
    if (response.status === 204) return null;
    const body: unknown = await response.json().catch(() => null);
    return isRecord(body) && typeof body.workflow_run_id === "number" ? body.workflow_run_id : null;
  }

  return {
    listDispatchRuns: () => listRuns(WORKFLOW_FILE),
    dispatch: (inputs) => dispatchFile(WORKFLOW_FILE, inputs),
    listWorkflowFileRuns: listRuns,
    dispatchWorkflowFile: dispatchFile,

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

export const CONFIG_WORKFLOW_FILE = "config.yml";

/** The repository variable holding the one cron that run.yml acts on. */
export const RUN_CRON_VARIABLE = "RUN_CRON";

/**
 * Sets a repository Actions variable, creating it when it does not exist. Needs the token's
 * "Variables: write" permission; without it GitHub answers 403 and this throws a GitHubError (its
 * message names the status only, never the token).
 */
export type VariableWriter = (name: string, value: string) => Promise<void>;

export function createVariableWriter(config: ServerConfig, fetchImpl: FetchLike): VariableWriter {
  const base = `${API}/repos/${config.owner}/${config.repo}/actions/variables`;

  function request(path: string, method: string, body: unknown): Promise<Response> {
    return fetchImpl(`${base}${path}`, {
      method,
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "dispatch-site",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  return async (name, value) => {
    const update = await request(`/${encodeURIComponent(name)}`, "PATCH", { name, value });
    if (update.ok) return;
    if (update.status !== 404) throw new GitHubError(update.status);
    const create = await request("", "POST", { name, value });
    if (!create.ok) throw new GitHubError(create.status);
  };
}

/** The two calls the config route makes on a workflow other than run.yml. */
export interface WorkflowDispatcher {
  /** Recent workflow_dispatch runs of the workflow on main, newest first. */
  listDispatchRuns(): Promise<WorkflowRun[]>;
  /** Starts the workflow on main. Returns the new run's id, or null when GitHub did not report one. */
  dispatch(inputs: Record<string, string>): Promise<number | null>;
}

/**
 * The same two calls as createGitHubClient makes for run.yml, for any workflow file. It goes through
 * that client, so the Generate flow keeps its fixed file name.
 */
export function createWorkflowDispatcher(
  config: ServerConfig,
  fetchImpl: FetchLike,
  workflowFile: string,
): WorkflowDispatcher {
  const client = createGitHubClient(config, fetchImpl);
  return {
    listDispatchRuns: () => client.listWorkflowFileRuns(workflowFile),
    dispatch: (inputs) => client.dispatchWorkflowFile(workflowFile, inputs),
  };
}
