import { stockholmDate } from "@singularity/core";
import { commitAndPush } from "../git/commit.js";
import { recordRunMetrics } from "../metrics/runMetrics.js";
import { recordFailure } from "../state/runRecord.js";
import { readLastRun, writeLastRun } from "../state/store.js";
import { failedRunMetrics } from "./collectMetrics.js";
import { decideKinds } from "./gate.js";
import { readPlan } from "./plan.js";
import { recordSpend } from "./spend.js";
import type { CommitReport, RunDeps, RunOptions } from "./types.js";

function report(reason: string, commit: CommitReport["commit"]): CommitReport {
  return {
    outcome: "failed",
    digests: [],
    deploy: false,
    items: 0,
    dry_run: false,
    commit,
    reason,
  };
}

/**
 * `--record-failed`: run.yml's last step when the job failed before the commit stage recorded an
 * outcome (an install that failed, a crash). Each kind the run was due to make reads `failed` in
 * state/last-run.json, committed through the write guard, so the next `health` reports
 * `run_failed` (and heals once) instead of reading the run before; the record, newer than the
 * run, keeps `run_died` quiet for it. The gate's plan says what was due; without one (the job died
 * before the gate) the gate is asked again. What the run's stages spent goes to the cost ledger
 * with it, so Firecrawl's weekly budget counts a failed run. Nothing but the spend is recorded for
 * a dry run, and nothing for a run that was not due or once the commit stage has committed. Replacements and on-demand
 * runs leave the cadence alone, so `run_died` still reports them. A run with a plan
 * leaves its metrics entry, a replacement or an on-demand run also its spend, which is how a failed
 * run shows in the failure rate; an on-demand run's cadence record stays as it was.
 *
 * A failed dry run leaves its spend and nothing else (D226): it paid for the same calls as a real
 * run, and Firecrawl's weekly count is read from the ledger.
 */
export async function recordFailedRun(deps: RunDeps, options: RunOptions): Promise<CommitReport> {
  const now = deps.now();
  const plan = await readPlan(deps.root).catch(() => null);
  const skip = (reason: string) => report(reason, { status: "nothing_to_commit" });
  if (plan?.committed_at !== undefined) return skip("The commit stage already committed this run.");
  if (plan?.dry_run || options.dryRun) {
    return plan
      ? recordFailedDryRun(deps, options, plan)
      : skip("A dry run with no plan spent nothing.");
  }
  if (
    plan?.replaces !== undefined ||
    options.replace !== undefined ||
    (plan?.mode ?? options.mode) === "on-demand"
  ) {
    return plan ? recordFailedOnDemand(deps, options, plan) : skip("Nothing is known of this run.");
  }

  const kinds = plan
    ? plan.passes.map((pass) => pass.kind)
    : (await decideKinds(deps, options, now)).kinds;
  if (kinds.length === 0) return skip("Nothing was due, so nothing was lost.");

  const at = now.toISOString();
  if (plan && deps.spend) {
    await deps.spend.resume(deps.root, plan.created_at);
    await recordSpend(deps.root, deps.spend, plan, at);
  }
  // A scheduled run's failure counts in the failure rate too; without a plan nothing is known of it.
  if (plan) await recordFailedMetrics(deps, plan, at);
  await writeLastRun(deps.root, recordFailure(await readLastRun(deps.root), kinds, at));
  const message = `chore(state): run ${stockholmDate(now)} failed`;
  const committed = await commitAndPush({
    root: deps.root,
    message,
    command: "run",
    push: !options.noPush,
    git: deps.git,
  });
  const reason = `Recorded failed for ${kinds.join(", ")}.`;
  return reportCommit(committed, reason, message);
}

/**
 * What a failure record's commit came to, in the same words for a scheduled run and an on-demand
 * one: a refused commit names the paths that broke the allowlist, a failed push its sha and cause.
 */
function reportCommit(
  committed: Awaited<ReturnType<typeof commitAndPush>>,
  reason: string,
  message: string,
): CommitReport {
  switch (committed.status) {
    case "pushed":
    case "committed":
      return report(reason, { status: committed.status, sha: committed.sha, message });
    case "nothing_to_commit":
      return report(reason, { status: "nothing_to_commit", message });
    case "refused":
      return report(`${reason} The commit was refused (${committed.reason}).`, {
        status: "refused",
        message,
        detail: committed.offending.join(", "),
      });
    case "push_failed":
      return report(`${reason} The push failed (${committed.reason}).`, {
        status: "push_failed",
        sha: committed.sha,
        message,
        detail: committed.detail,
      });
  }
}

/**
 * The failed run's entry in the run metrics, so the failure rate counts it. Best effort, as in the
 * commit stage: a metric never stops the failure record or its commit.
 */
async function recordFailedMetrics(
  deps: RunDeps,
  plan: NonNullable<Awaited<ReturnType<typeof readPlan>>>,
  at: string,
): Promise<void> {
  try {
    await recordRunMetrics(
      deps.root,
      await failedRunMetrics({
        root: deps.root,
        plan,
        at,
        stage: "unknown",
        reason: "The job stopped before the commit stage.",
      }),
    );
  } catch (error) {
    deps.log.warn("The failed run's metrics were not recorded", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A failed Regenerate or Generate: nothing about the cadence changes, but the run's spend and its
 * failure go on record, so the failure rate and the cost of failed runs can be read.
 */
async function recordFailedOnDemand(
  deps: RunDeps,
  options: RunOptions,
  plan: NonNullable<Awaited<ReturnType<typeof readPlan>>>,
): Promise<CommitReport> {
  const at = deps.now().toISOString();
  if (deps.spend) {
    await deps.spend.resume(deps.root, plan.created_at);
    await recordSpend(deps.root, deps.spend, plan, at);
  }
  await recordFailedMetrics(deps, plan, at);
  const message = `chore(state): run ${stockholmDate(deps.now())} failed`;
  const committed = await commitAndPush({
    root: deps.root,
    message,
    command: "run",
    push: !options.noPush,
    git: deps.git,
  });
  const reason = "Recorded the failed on-demand run.";
  return reportCommit(committed, reason, message);
}

/**
 * A failed dry run: its spend goes to the cost ledger in a commit of the ledger alone, as a dry run
 * that finished does (`commitDryRunCosts`). The cadence, the metrics and the digests are left alone.
 * A ledger row's id carries the run, so a run recorded twice counts once.
 */
async function recordFailedDryRun(
  deps: RunDeps,
  options: RunOptions,
  plan: NonNullable<Awaited<ReturnType<typeof readPlan>>>,
): Promise<CommitReport> {
  const now = deps.now();
  if (deps.spend) {
    await deps.spend.resume(deps.root, plan.created_at);
    await recordSpend(deps.root, deps.spend, plan, now.toISOString());
  }
  const message = `chore(costs): dry run ${stockholmDate(now)} failed`;
  const committed = await commitAndPush({
    root: deps.root,
    message,
    command: "costs",
    push: !options.noPush,
    git: deps.git,
  });
  return reportCommit(committed, "Recorded the failed dry run's spend.", message);
}
