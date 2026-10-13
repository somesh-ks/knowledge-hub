import { redact } from "../context.js";
import { describeError } from "../llm/errors.js";
import { commitStage } from "./commitStage.js";
import { StageFailure, UsageError } from "./errors.js";
import { fetchStage } from "./fetchStage.js";
import { gateStage } from "./gate.js";
import { judgeStage } from "./judgeStage.js";
import { type Plan, requirePlan } from "./plan.js";
import type {
  CommitReport,
  FailureReport,
  PipelineResult,
  RunDeps,
  RunOptions,
  StageName,
  StageReport,
} from "./types.js";
import { validateStage } from "./validateStage.js";
import { writeStage } from "./writeStage.js";

function failure(deps: RunDeps, stage: StageName, error: unknown, dryRun: boolean): PipelineResult {
  if (error instanceof UsageError) {
    // Printed by the caller as a usage message; the report still carries the failure shape.
    return {
      code: 2,
      report: failureReport(stage, redact(error.message, deps.secrets), dryRun),
    };
  }
  const message =
    error instanceof StageFailure
      ? redact(error.message, deps.secrets)
      : describeError(error, deps.secrets);
  return { code: 1, report: failureReport(stage, message, dryRun) };
}

function failureReport(stage: StageName, error: string, dryRun: boolean): FailureReport {
  return { outcome: "failed", stage, error, dry_run: dryRun, digests: [], deploy: false, items: 0 };
}

function commitCode(report: CommitReport): number {
  return report.outcome === "failed" ? 1 : 0;
}

/** The plan with `--dry-run` folded in, so every stage reads one answer. */
async function loadPlan(deps: RunDeps, options: RunOptions): Promise<Plan> {
  const plan = await requirePlan(deps.root);
  return { ...plan, dry_run: plan.dry_run || options.dryRun };
}

async function runPassStage(
  deps: RunDeps,
  options: RunOptions,
  stage: "fetch" | "judge" | "write" | "validate",
): Promise<StageReport> {
  const plan = await loadPlan(deps, options);
  // Spend is saved after every stage, failed or not, so the next stage (a new process in the
  // workflow) carries on from the same Firecrawl ceiling and the commit stage can report it all.
  await deps.spend?.begin(deps.root, plan.created_at);
  try {
    const report = await runStage(deps, plan, stage, options.feedback);
    return deps.spend ? { ...report, spend: deps.spend.totals() } : report;
  } finally {
    await deps.spend?.save(deps.root);
  }
}

function runStage(
  deps: RunDeps,
  plan: Plan,
  stage: "fetch" | "judge" | "write" | "validate",
  feedback?: string,
): Promise<StageReport> {
  switch (stage) {
    case "fetch":
      return fetchStage(deps, plan);
    case "judge":
      return judgeStage(deps, plan);
    case "write":
      return writeStage(deps, plan, feedback);
    case "validate":
      return validateStage(deps, plan);
    default: {
      const unreachable: never = stage;
      throw new Error(`Unhandled stage ${String(unreachable)}`);
    }
  }
}

/**
 * The pipeline as a pure function of its dependencies. With `stage` it runs that one stage, as a
 * workflow step does; without it every stage runs in order and stops cleanly when the gate says
 * nothing is due. Any stage that fails stops the run with outcome "failed" before the commit
 * stage, so state is never touched by a half-finished run.
 */
export async function runPipeline(deps: RunDeps, options: RunOptions): Promise<PipelineResult> {
  let current: StageName = options.stage ?? "gate";
  try {
    if (options.stage !== undefined) {
      switch (options.stage) {
        case "gate":
          return { code: 0, report: await gateStage(deps, options) };
        case "commit": {
          const report = await commitStage(deps, options);
          return { code: commitCode(report), report };
        }
        case "fetch":
        case "judge":
        case "write":
        case "validate":
          return { code: 0, report: await runPassStage(deps, options, options.stage) };
        default: {
          const unreachable: never = options.stage;
          throw new Error(`Unhandled stage ${String(unreachable)}`);
        }
      }
    }

    current = "gate";
    const gate = await gateStage(deps, options);
    if (gate.due) {
      for (const stage of ["fetch", "judge", "write", "validate"] as const) {
        current = stage;
        const report = await runPassStage(deps, options, stage);
        deps.log.info(`Stage ${stage} done`, {
          passes: report.passes.map((pass) => pass.id),
        });
      }
    }
    current = "commit";
    const report = await commitStage(deps, options);
    return { code: commitCode(report), report };
  } catch (error) {
    return failure(deps, current, error, options.dryRun);
  }
}
