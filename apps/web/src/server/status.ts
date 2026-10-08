import { type GenerateStep, STEP_FOR_WORKFLOW_STEP, type StatusResponse } from "../types/contracts";
import { readServerConfig, type ServerConfig, type ServerEnv, secretsOf } from "./config";
import {
  createGitHubClient,
  type FetchLike,
  PODCAST_WORKFLOW_FILE,
  WORKFLOW_FILE,
  type WorkflowRun,
  type WorkflowStep,
} from "./github";
import type { ApiResult } from "./http";
import { describeError } from "./redact";

/**
 * GET /api/status?run=<id>: progress of one Generate run. It answers only for a workflow_dispatch run
 * of run.yml in this repository, so it cannot be used to read any other run. The body is built field by
 * field, so nothing from GitHub passes through that the sheet does not use.
 */

export type StatusBody =
  | StatusResponse
  | { error: "invalid_request" | "not_found" | "unavailable" };

export interface StatusDeps {
  env: ServerEnv;
  fetch: FetchLike;
  log?: (message: string) => void;
}

/** Polls are frequent and the answer changes slowly, so a short browser cache absorbs repeats. */
export const STATUS_CACHE_CONTROL = "private, max-age=3";
const RUN_ID = /^[1-9]\d{0,14}$/;
/** A run record older than this before the run started belongs to an earlier run. */
const RECORD_SLACK_MS = 60_000;

const notFound: ApiResult<StatusBody> = { status: 404, body: { error: "not_found" } };

export function parseRunId(value: string | null): number | null {
  if (value === null || !RUN_ID.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

const workflowPath = (run: WorkflowRun): string => run.path.split("@")[0] ?? "";

/** Whether a run is an episode run: podcast.yml, which has no named steps and no last-run record. */
export function isPodcastRun(run: WorkflowRun): boolean {
  return workflowPath(run) === `.github/workflows/${PODCAST_WORKFLOW_FILE}`;
}

/**
 * Whether a run is a workflow_dispatch run of run.yml (a briefing) or podcast.yml (an episode) in
 * the configured repository.
 */
export function isOurRun(run: WorkflowRun, config: ServerConfig): boolean {
  const path = workflowPath(run);
  return (
    run.event === "workflow_dispatch" &&
    (path === `.github/workflows/${WORKFLOW_FILE}` || isPodcastRun(run)) &&
    run.repositoryFullName.toLowerCase() === config.repository.toLowerCase()
  );
}

function stateOf(run: WorkflowRun): StatusResponse["state"] {
  if (run.status === "completed") return "completed";
  if (run.status === "in_progress") return "running";
  return "queued";
}

function stepNameToProgress(name: string): GenerateStep | null {
  return STEP_FOR_WORKFLOW_STEP[name] ?? null;
}

/**
 * The step to show as current. While running that is the step in progress, or the latest finished
 * one when GitHub is between steps; before any named step has started it is "waiting".
 */
export function currentStep(steps: readonly WorkflowStep[]): GenerateStep {
  const named = steps
    .filter((step) => stepNameToProgress(step.name) !== null)
    .sort((a, b) => a.number - b.number);
  const running = named.find((step) => step.status === "in_progress");
  const latest = running ?? named.filter((step) => step.status === "completed").at(-1);
  return (latest ? stepNameToProgress(latest.name) : null) ?? "waiting";
}

/** The step a failed run stopped at, so the sheet can mark exactly that row. */
export function failedStep(steps: readonly WorkflowStep[]): GenerateStep | null {
  const failed = steps
    .filter((step) => step.conclusion === "failure" || step.conclusion === "timed_out")
    .sort((a, b) => a.number - b.number)[0];
  return failed ? stepNameToProgress(failed.name) : null;
}

/**
 * Narration runs in a nested job after the digest is committed, and its failure fails the whole
 * run. When that is the only failure the briefing is live, so the sheet reads the run's record
 * instead of reporting a failed run.
 */
export function isAudioOnlyFailure(steps: readonly WorkflowStep[]): boolean {
  const failed = steps.filter(
    (step) => step.conclusion === "failure" || step.conclusion === "timed_out",
  );
  return failed.length > 0 && failed.every((step) => step.name === "Audio");
}

interface OnDemandRecord {
  at: string;
  outcome: "published" | "nothing" | "gated" | "failed";
  digestId: string | null;
}

const OUTCOMES = new Set(["published", "nothing", "gated", "failed"]);
const DIGEST_ID = /^\d{4}-\d{2}-\d{2}(-weekly|-[2-9]|-[1-9]\d+)?$/;

/** The on_demand record of state/last-run.json, validated by hand to keep zod out of the function. */
export function parseOnDemandRecord(text: string): OnDemandRecord | null {
  try {
    const file: unknown = JSON.parse(text);
    const record = (file as { on_demand?: unknown } | null)?.on_demand as
      | { at?: unknown; outcome?: unknown; digest_id?: unknown }
      | undefined;
    if (!record || typeof record.at !== "string" || typeof record.outcome !== "string") return null;
    if (!OUTCOMES.has(record.outcome) || !Number.isFinite(Date.parse(record.at))) return null;
    const digestId =
      typeof record.digest_id === "string" && DIGEST_ID.test(record.digest_id)
        ? record.digest_id
        : null;
    return { at: record.at, outcome: record.outcome as OnDemandRecord["outcome"], digestId };
  } catch {
    return null;
  }
}

export function runUrlFor(config: ServerConfig, runId: number): string {
  return `https://github.com/${config.repository}/actions/runs/${runId}`;
}

export async function handleStatus(
  runParam: string | null,
  deps: StatusDeps,
): Promise<ApiResult<StatusBody>> {
  const config = readServerConfig(deps.env);
  if (!config) return { status: 503, body: { error: "unavailable" } };
  const runId = parseRunId(runParam);
  if (runId === null) return { status: 400, body: { error: "invalid_request" } };

  const github = createGitHubClient(config, deps.fetch);
  const log = deps.log ?? (() => {});
  try {
    const run = await github.getRun(runId);
    // Unknown, foreign and unrelated runs all look the same, so the endpoint tells nothing about them.
    if (!run || !isOurRun(run, config)) return notFound;

    const state = stateOf(run);
    const headers = { "Cache-Control": STATUS_CACHE_CONTROL };

    // An episode run reports only whether it is still going and whether it worked: its steps have no
    // names the sheet knows, and it leaves no record in state/last-run.json.
    if (isPodcastRun(run)) {
      if (state !== "completed")
        return { status: 200, headers, body: { run_id: runId, state, step: null } };
      const done = run.conclusion === "success";
      return {
        status: 200,
        headers,
        body: {
          run_id: runId,
          state,
          step: null,
          outcome: done ? "published" : "failed",
          ...(done ? {} : { run_url: runUrlFor(config, runId) }),
        },
      };
    }

    const steps = await github.listSteps(runId);

    if (state !== "completed") {
      return { status: 200, headers, body: { run_id: runId, state, step: currentStep(steps) } };
    }

    const runUrl = runUrlFor(config, runId);
    if (run.conclusion !== "success" && !isAudioOnlyFailure(steps)) {
      return {
        status: 200,
        headers,
        body: {
          run_id: runId,
          state,
          step: failedStep(steps),
          outcome: "failed",
          run_url: runUrl,
        },
      };
    }

    const recordText = await github.readFile("state/last-run.json", "main");
    const record = recordText ? parseOnDemandRecord(recordText) : null;
    const startedAt = Date.parse(run.startedAt ?? run.createdAt);
    const isFresh = record !== null && Date.parse(record.at) >= startedAt - RECORD_SLACK_MS;
    if (!record || !isFresh) {
      // The run succeeded but left no record of its own, so its outcome is unknown. Say so plainly.
      return {
        status: 200,
        headers,
        body: { run_id: runId, state, step: null, outcome: "failed", run_url: runUrl },
      };
    }
    return {
      status: 200,
      headers,
      body: {
        run_id: runId,
        state,
        step: null,
        outcome: record.outcome,
        ...(record.outcome === "published" && record.digestId
          ? { digest_id: record.digestId }
          : {}),
        ...(record.outcome === "failed" ? { run_url: runUrl } : {}),
      },
    };
  } catch (error) {
    log(`status failed: ${describeError(error, secretsOf(config))}`);
    return { status: 503, body: { error: "unavailable" } };
  }
}
