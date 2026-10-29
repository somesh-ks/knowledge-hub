import { costKindOf, priceSpend } from "../cost/ledger.js";
import type { RunOutcome, RunRecord, StageRecord } from "../store/runsStore.js";
import { readPlan } from "./plan.js";
import { readRunSpend } from "./spend.js";
import { readStageClock } from "./stageClock.js";

/** How the job ended, as GitHub's `job.status` says it. */
export type JobResult = "success" | "failure" | "cancelled";

/**
 * The record of the run in progress, from what its stages left on the runner: the plan, the stage
 * clock (time and cost per stage, and the stage that failed) and the spend. Null when the run has no
 * plan (the job died before the gate wrote one), which nothing can be said of. Missing pieces read
 * as zero, never as a failure: the log describes a run, it never stops one (D221).
 */
export async function buildRunRecord(input: {
  root: string;
  now: Date;
  result: JobResult;
  /** The commit stage's outcome (`published` or `nothing`); blank when it did not get that far. */
  outcome: string;
  githubRunId: string | undefined;
}): Promise<RunRecord | null> {
  const plan = await readPlan(input.root).catch(() => null);
  if (!plan) return null;
  const clock = await readStageClock(input.root, plan.created_at);
  const spend = await readRunSpend(input.root, plan.created_at);
  const stages: StageRecord[] = Object.entries(clock.stages).map(([stage, ms]) => ({
    stage,
    ms,
    usd: clock.usd?.[stage] ?? 0,
  }));
  const outcome: RunOutcome =
    input.result === "cancelled"
      ? "cancelled"
      : input.result === "failure"
        ? "failed"
        : input.outcome === "published"
          ? "published"
          : "nothing";
  const started = Date.parse(plan.created_at);
  const finished = input.now.getTime();
  return {
    run_id: plan.created_at,
    workflow: "run",
    kind: costKindOf(plan.passes[0]?.kind ?? "regular"),
    mode: plan.mode,
    replaces: plan.replaces ?? null,
    dry_run: plan.dry_run,
    outcome,
    podcasts: plan.passes.map((pass) => pass.id),
    started_at: plan.created_at,
    finished_at: input.now.toISOString(),
    work_ms: stages.reduce((sum, stage) => sum + stage.ms, 0),
    total_ms: Number.isFinite(started) ? finished - started : 0,
    usd: spend ? await priceSpend(input.root, spend) : 0,
    failure:
      outcome === "failed" || outcome === "cancelled"
        ? (clock.failure ?? { stage: "unknown", reason: `The job ended ${input.result}.` })
        : null,
    github_run_id: input.githubRunId ?? null,
    stages,
  };
}
