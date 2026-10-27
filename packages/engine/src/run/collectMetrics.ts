import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import type { RunMetric } from "../metrics/runMetrics.js";
import { type Plan, type PlanPass, passFile } from "./plan.js";
import { readStageClock } from "./stageClock.js";

const count = z.number().int().nonnegative();

/** The fields of `validate-report.json` the metrics read; older reports lack the newer ones. */
const ValidateReport = z
  .object({
    verified: z.boolean().optional(),
    written: count.optional(),
    kept: count.optional(),
    grounding_dropped: count.optional(),
    grounding_pruned: count.optional(),
    validate_dropped: z.array(z.unknown()).optional(),
    allowance_trimmed: z.array(z.unknown()).optional(),
    refill_written: count.optional(),
    refill_kept: count.optional(),
    aired_chars: count.optional(),
    length_chars: count.nullable().optional(),
  })
  .passthrough();

export interface PassOutcome {
  pass: PlanPass;
  /** The digest's id once published; the pass's own id for a pass that made nothing. */
  digestId: string;
  outcome: "published" | "nothing";
  verified: boolean;
  aired: number;
  /** Stories in the pass's pool. */
  pool: number;
}

/**
 * One metric per pass for a finished run, from what its stages left on the runner: the stage clock,
 * the validate report and the pass's pool. Missing pieces read as zero or null, never as a failure:
 * a metric describes a run, it never stops one.
 */
export async function collectRunMetrics(input: {
  root: string;
  plan: Plan;
  passes: readonly PassOutcome[];
  at: string;
  /** Wall time to the moment generation finished, before any hold for the publish time. */
  totalMs: number;
  modelFallbacks: number;
}): Promise<RunMetric[]> {
  const clock = await readStageClock(input.root, input.plan.created_at);
  const metrics: RunMetric[] = [];
  for (const entry of input.passes) {
    const raw = await readJsonIfExists(
      passFile(input.root, entry.pass.id, "validate-report.json"),
      "validate-report.json",
    ).catch(() => null);
    const parsed = raw === null ? null : ValidateReport.safeParse(raw);
    const report = parsed?.success ? parsed.data : {};
    const asked = report.length_chars ?? null;
    const aired = report.aired_chars ?? null;
    metrics.push({
      run_id: input.plan.created_at,
      at: input.at,
      digest_id: entry.digestId,
      kind: entry.pass.kind,
      mode: input.plan.mode,
      replace: input.plan.replaces !== undefined,
      outcome: entry.outcome,
      stage_ms: clock.stages,
      total_ms: Math.max(0, Math.round(input.totalMs)),
      funnel: {
        pool: entry.pool,
        written: report.written ?? 0,
        grounding_dropped: report.grounding_dropped ?? 0,
        grounding_pruned: report.grounding_pruned ?? 0,
        validate_dropped:
          (report.validate_dropped?.length ?? 0) + (report.allowance_trimmed?.length ?? 0),
        refill_written: report.refill_written ?? 0,
        refill_kept: report.refill_kept ?? 0,
        aired: entry.aired,
      },
      length: {
        asked_chars: asked,
        aired_chars: aired,
        share:
          asked !== null && asked > 0 && aired !== null
            ? Math.round((aired / asked) * 100) / 100
            : null,
      },
      verified: entry.verified,
      model_fallbacks: input.modelFallbacks,
    });
  }
  return metrics;
}

/** The record of a run that stopped: what it was making, the stage and the reason, no funnel. */
export async function failedRunMetrics(input: {
  root: string;
  plan: Plan;
  at: string;
  stage: string;
  reason: string;
}): Promise<RunMetric[]> {
  const clock = await readStageClock(input.root, input.plan.created_at);
  const failure = {
    stage: clock.failure?.stage ?? input.stage,
    reason: clock.failure?.reason ?? input.reason,
  };
  return input.plan.passes.map((pass) => ({
    run_id: input.plan.created_at,
    at: input.at,
    digest_id: pass.id,
    kind: pass.kind,
    mode: input.plan.mode,
    replace: input.plan.replaces !== undefined,
    outcome: "failed" as const,
    stage_ms: clock.stages,
    funnel: {
      pool: 0,
      written: 0,
      grounding_dropped: 0,
      grounding_pruned: 0,
      validate_dropped: 0,
      refill_written: 0,
      refill_kept: 0,
      aired: 0,
    },
    length: { asked_chars: null, aired_chars: null, share: null },
    verified: false,
    model_fallbacks: 0,
    failure,
  }));
}
