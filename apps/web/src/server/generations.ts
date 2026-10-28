import type { GenerationRow } from "../types/contracts";
import { readServerConfig, type ServerEnv, secretsOf } from "./config";
import { isSameOrigin } from "./generate";
import { createGitHubClient, type FetchLike, type WorkflowRun } from "./github";
import type { ApiResult } from "./http";
import { describeError } from "./redact";
import { isOurRun, isPodcastRun, parseRunId, progressOf } from "./status";

/**
 * GET /api/generations: what is being made right now, and POST /api/cancel: stop one of them. A
 * generation is a briefing (run.yml) or an episode (podcast.yml) that someone dispatched, whether
 * this person, another device or the schedule. The list is built from GitHub's own run list, so it
 * keeps no state, and each row is built field by field like the status route's. A cancel answers
 * only for a dispatched run of those two workflows (the status route's own test), so it cannot be
 * used to stop a config save or anything else in the repository. The schedule's briefing is one
 * of them, and with no auth (D201) anyone with the URL can stop it, as they can already delete.
 */

/** Most rows a list answers with: one running and one waiting run for each of the two workflows. */
const MAX_ROWS = 6;

export type GenerationsBody = { generations: GenerationRow[] } | { error: "unavailable" };

export type CancelBody =
  | { run_id: number; cancelled: true }
  | { error: "cooldown"; retry_after_s: number }
  | { error: "invalid_request" | "not_found" | "already_finished" | "unavailable" };

export interface GenerationsDeps {
  env: ServerEnv;
  fetch: FetchLike;
  log?: (message: string) => void;
}

export interface CancelDeps extends GenerationsDeps {
  /** The shared per-minute cap (D150): seconds to wait, or 0. Taken only after the checks. */
  burst?: () => Promise<number>;
}

/** The list is polled while it is open; a short browser cache absorbs a double tap or a second tab. */
export const GENERATIONS_CACHE_CONTROL = "private, max-age=3";
export const MAX_CANCEL_BODY_CHARS = 256;

/** A delete and a dry run are runs of run.yml too, but nobody is waiting for a briefing from them. */
const isGeneration = (run: WorkflowRun): boolean =>
  !run.title.startsWith("delete ") && run.title !== "dry run";

export async function handleGenerations(
  deps: GenerationsDeps,
): Promise<ApiResult<GenerationsBody>> {
  const config = readServerConfig(deps.env);
  if (!config) return { status: 503, body: { error: "unavailable" } };
  const log = deps.log ?? (() => {});
  const github = createGitHubClient(config, deps.fetch);
  try {
    const active = (await github.listActiveRuns())
      .filter((run) => isOurRun(run, config) && isGeneration(run))
      .slice(0, MAX_ROWS);
    const generations = await Promise.all(
      active.map(async (run): Promise<GenerationRow> => {
        const { state, stage, stages, label, stage_estimates_ms } = await progressOf(run, github);
        return {
          run_id: run.id,
          what: isPodcastRun(run) ? "episode" : "briefing",
          // The list holds runs that have not finished, so a state of "completed" cannot arise
          // unless the run ended between the two calls; it reads as running until the next poll.
          state: state === "queued" ? "queued" : "running",
          started_at: run.createdAt,
          stage,
          stages,
          label,
          ...(stage_estimates_ms ? { stage_estimates_ms } : {}),
        };
      }),
    );
    return {
      status: 200,
      headers: { "Cache-Control": GENERATIONS_CACHE_CONTROL },
      body: { generations },
    };
  } catch (error) {
    log(`generations failed: ${describeError(error, secretsOf(config))}`);
    return { status: 503, body: { error: "unavailable" } };
  }
}

/** The run id of a cancel request's body (`{"run_id": 123}`), or null for anything else. */
export function parseCancelBody(bodyText: string): number | null {
  try {
    const body: unknown = JSON.parse(bodyText);
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const id = (body as { run_id?: unknown }).run_id;
    return typeof id === "number" ? parseRunId(String(id)) : null;
  } catch {
    return null;
  }
}

export async function handleCancel(
  input: { bodyText: string; origin: string | null; expectedOrigin: string },
  deps: CancelDeps,
): Promise<ApiResult<CancelBody>> {
  const config = readServerConfig(deps.env);
  if (!config) return { status: 503, body: { error: "unavailable" } };
  if (!isSameOrigin(input.origin, input.expectedOrigin)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const runId = parseCancelBody(input.bodyText);
  if (runId === null) return { status: 400, body: { error: "invalid_request" } };

  const wait = (await deps.burst?.()) ?? 0;
  if (wait > 0) {
    return {
      status: 429,
      headers: { "Retry-After": String(wait) },
      body: { error: "cooldown", retry_after_s: wait },
    };
  }

  const log = deps.log ?? (() => {});
  const github = createGitHubClient(config, deps.fetch);
  try {
    const run = await github.getRun(runId);
    // Unknown, foreign and unrelated runs all look the same, as the status route's do.
    if (!run || !isOurRun(run, config)) return { status: 404, body: { error: "not_found" } };
    if (run.status === "completed") return { status: 409, body: { error: "already_finished" } };
    const outcome = await github.cancelRun(runId);
    if (outcome === "finished") return { status: 409, body: { error: "already_finished" } };
    return { status: 202, body: { run_id: runId, cancelled: true } };
  } catch (error) {
    log(`cancel failed: ${describeError(error, secretsOf(config))}`);
    return { status: 503, body: { error: "unavailable" } };
  }
}
