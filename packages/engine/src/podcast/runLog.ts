import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAllCosts } from "../cost/ledger.js";
import type { JobResult } from "../run/runLog.js";
import type { RunOutcome, RunRecord, StageRecord } from "../store/runsStore.js";

/** One stage artifact the episode steps keep on the runner, or null when it is missing. */
async function readArtifact(dir: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The record of the Catch up run in progress (D220), from what its steps left in the artifact
 * directory: the episode id the select stage allocated, the stage times, and the stage that failed.
 * The cost is what the ledger holds for the episode (the script step records the writer's tokens
 * there), shown on the script stage. A delete is not a run worth measuring, so it has no record.
 * Null when the request names a delete or does not parse; missing artifacts read as zero.
 */
export async function buildEpisodeRunRecord(input: {
  root: string;
  /** The request JSON of the run, as podcast.yml gives it to every step. */
  request: string;
  /** Where the steps keep their results (`$RUNNER_TEMP/podcast-stages`). */
  artifacts: string;
  now: Date;
  /** When this job began (`RUN_STARTED_AT`). A resumed attempt restores the earlier attempts' stage times. */
  startedAt: string | undefined;
  result: JobResult;
  githubRunId: string | undefined;
}): Promise<RunRecord | null> {
  let request: unknown;
  try {
    request = JSON.parse(input.request);
  } catch {
    return null;
  }
  if (!isRecord(request) || request.action === "delete") return null;
  const regenerate = request.action === "regenerate";
  const selected = await readArtifact(input.artifacts, "select");
  const timings = await readArtifact(input.artifacts, "timings");
  const failure = await readArtifact(input.artifacts, "failure");
  const episodeId = isRecord(selected) && typeof selected.id === "string" ? selected.id : undefined;
  const runId = episodeId ?? `podcast-${input.githubRunId ?? input.now.getTime()}`;
  const usd = episodeId
    ? (await loadAllCosts(input.root).catch(() => []))
        .filter((record) => record.run_id === episodeId)
        .reduce((sum, record) => sum + record.usd, 0)
    : 0;
  const stages: StageRecord[] = isRecord(timings)
    ? Object.entries(timings).flatMap(([stage, ms]) =>
        typeof ms === "number" ? [{ stage, ms, usd: stage === "script" ? usd : 0 }] : [],
      )
    : [];
  const outcome: RunOutcome =
    input.result === "success"
      ? "published"
      : input.result === "cancelled"
        ? "cancelled"
        : "failed";
  const started = Date.parse(input.startedAt ?? "");
  const finished = input.now.getTime();
  const workMs = stages.reduce((sum, stage) => sum + stage.ms, 0);
  // A retry restores the first attempt's stage times, so the job's own span can be shorter than the
  // work it reports; the run then starts that much earlier and total_ms never falls below work_ms.
  const totalMs = Number.isFinite(started) ? Math.max(workMs, finished - started) : workMs;
  return {
    run_id: runId,
    workflow: "podcast",
    kind: "catch_up",
    mode: regenerate ? "regenerate" : "create",
    replaces: regenerate && typeof request.id === "string" ? request.id : null,
    dry_run: false,
    outcome,
    podcasts: episodeId ? [episodeId] : [],
    started_at: new Date(finished - totalMs).toISOString(),
    finished_at: input.now.toISOString(),
    work_ms: workMs,
    total_ms: totalMs,
    usd,
    failure:
      outcome === "published"
        ? null
        : {
            stage:
              isRecord(failure) && typeof failure.failed_stage === "string"
                ? failure.failed_stage
                : "unknown",
            reason:
              isRecord(failure) && typeof failure.reason === "string"
                ? failure.reason
                : `The job ended ${input.result}.`,
          },
    github_run_id: input.githubRunId ?? null,
    stages,
  };
}
