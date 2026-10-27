import { join } from "node:path";
import { DigestId, DigestKind } from "@singularity/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { runDirFor } from "../curate/runDir.js";
import { RUN_MODES } from "../gate/decideRun.js";
import { StageFailure } from "./errors.js";
import type { StageName } from "./types.js";

const isoDateTime = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();

export const PlanPass = z.object({
  id: DigestId,
  kind: DigestKind,
  window: z.object({ from: isoDateTime, to: isoDateTime }),
});
export type PlanPass = z.infer<typeof PlanPass>;

/**
 * `.cache/run/plan.json`: what the gate decided, read by every later stage so a workflow step
 * needs no flags. `dry_run` lives here because only the gate step receives `--dry-run`.
 */
export const Plan = z.object({
  version: z.literal(1),
  mode: z.enum(RUN_MODES),
  dry_run: z.boolean(),
  created_at: isoDateTime,
  /** Calendar date the gate decided for, in the schedule's time zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string(),
  passes: z.array(PlanPass),
  /** The digest this run replaces: its files go in the commit that publishes the new one. */
  replaces: DigestId.optional(),
  /** "adopted" plans come from an agent-mode run directory; no gate ran. */
  source: z.enum(["gate", "adopted"]).default("gate"),
  /** When to publish: the scheduled time a run that started ahead waits for (D193). */
  publish_at: isoDateTime.optional(),
  /** Set once the commit stage finished, so a second commit cannot publish the same run twice. */
  committed_at: isoDateTime.optional(),
});
export type Plan = z.infer<typeof Plan>;

/** Per-pass progress. A stage that re-runs clears everything after it. */
export const PassState = z.object({
  version: z.literal(1),
  id: DigestId,
  kind: DigestKind,
  fetch: z.object({ at: isoDateTime }).optional(),
  judge: z.object({ at: isoDateTime }).optional(),
  write: z.object({ at: isoDateTime, outcome: z.enum(["selected", "nothing"]) }).optional(),
  validate: z
    .object({
      at: isoDateTime,
      outcome: z.enum(["selected", "nothing"]),
      verified: z.boolean(),
      items: count,
    })
    .optional(),
});
export type PassState = z.infer<typeof PassState>;

type PassStageName = Exclude<StageName, "gate" | "commit">;
const PASS_STAGE_ORDER: readonly PassStageName[] = ["fetch", "judge", "write", "validate"];

export function runCacheDir(root: string): string {
  return join(root, ".cache", "run");
}

export function planPath(root: string): string {
  return join(runCacheDir(root), "plan.json");
}

/** Run-level cache of judge answers, merged into state/judgments.json at commit. */
export function runJudgmentsPath(root: string): string {
  return join(runCacheDir(root), "judgments.json");
}

/** Run-level cache of custom-topic fits, merged into state/topic-judgments.json at commit. */
export function runTopicJudgmentsPath(root: string): string {
  return join(runCacheDir(root), "topic-judgments.json");
}

export function passDir(root: string, id: string): string {
  return runDirFor(root, id);
}

export function passFile(root: string, id: string, name: string): string {
  return join(passDir(root, id), name);
}

export async function readPlan(root: string): Promise<Plan | null> {
  const raw = await readJsonIfExists(planPath(root), ".cache/run/plan.json");
  if (raw === null) return null;
  const parsed = Plan.safeParse(raw);
  if (!parsed.success) {
    throw new StageFailure(".cache/run/plan.json is invalid. Run the gate stage again.");
  }
  return parsed.data;
}

export async function requirePlan(root: string): Promise<Plan> {
  const plan = await readPlan(root);
  if (plan === null) {
    throw new StageFailure("No plan found. Run `singularity run --stage gate` first.");
  }
  return plan;
}

export async function writePlan(root: string, plan: Plan): Promise<void> {
  await writeJson(planPath(root), Plan.parse(plan));
}

export function newPassState(pass: Pick<PlanPass, "id" | "kind">): PassState {
  return { version: 1, id: pass.id, kind: pass.kind };
}

export async function readPassState(root: string, pass: PlanPass): Promise<PassState> {
  const raw = await readJsonIfExists(passFile(root, pass.id, "stages.json"), "stages.json");
  const parsed = raw === null ? null : PassState.safeParse(raw);
  // A state file for another id or kind is a leftover of an earlier run, not progress.
  return parsed?.success && parsed.data.id === pass.id && parsed.data.kind === pass.kind
    ? parsed.data
    : newPassState(pass);
}

export async function writePassState(root: string, state: PassState): Promise<void> {
  await writeJson(passFile(root, state.id, "stages.json"), PassState.parse(state));
}

/** Record a finished stage and forget the stages after it, which now rest on changed input. */
export async function markStage<S extends PassStageName>(
  root: string,
  pass: PlanPass,
  stage: S,
  data: NonNullable<PassState[S]>,
): Promise<PassState> {
  const current = await readPassState(root, pass);
  const earlier = PASS_STAGE_ORDER.slice(0, PASS_STAGE_ORDER.indexOf(stage)).flatMap((name) =>
    current[name] === undefined ? [] : [[name, current[name]] as const],
  );
  const next = PassState.parse({
    version: 1,
    id: current.id,
    kind: current.kind,
    ...Object.fromEntries(earlier),
    [stage]: data,
  });
  await writePassState(root, next);
  return next;
}

/** Fail with a clear message when an earlier stage did not run for this pass. */
export async function requireStage(
  root: string,
  pass: PlanPass,
  stage: PassStageName,
  needed: string,
): Promise<PassState> {
  const state = await readPassState(root, pass);
  if (state[stage] === undefined) {
    throw new StageFailure(
      `${pass.id}: the ${stage} stage has not run, so ${needed} cannot start. Run \`singularity run --stage ${stage}\` first.`,
    );
  }
  return state;
}
