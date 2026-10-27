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
 * with it, so Firecrawl's weekly budget counts a failed run. Nothing is recorded for a dry run, a
 * replacement or an on-demand run (they leave the cadence alone, so `run_died` still reports
 * them), for a run that was not due, or once the commit stage has committed. A replacement or an
 * on-demand run still leaves its metrics entry and its spend, which is how a Regenerate that fails
 * shows in the failure rate; the cadence record stays as it was.
 */
export async function recordFailedRun(deps: RunDeps, options: RunOptions): Promise<CommitReport> {
  const now = deps.now();
  const plan = await readPlan(deps.root).catch(() => null);
  const skip = (reason: string) => report(reason, { status: "nothing_to_commit" });
  if (plan?.committed_at !== undefined) return skip("The commit stage already committed this run.");
  if (plan?.dry_run || options.dryRun) return skip("A dry run records nothing.");
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
  const message = `chore(state): run ${stockholmDate(deps.now())} failed`;
  const committed = await commitAndPush({
    root: deps.root,
    message,
    command: "run",
    push: !options.noPush,
    git: deps.git,
  });
  const reason = "Recorded the failed on-demand run.";
  if (committed.status === "refused" || committed.status === "push_failed") {
    return report(`${reason} The commit did not land (${committed.status}).`, {
      status: committed.status,
      message,
    });
  }
  return report(reason, {
    status: committed.status,
    message,
    ...("sha" in committed ? { sha: committed.sha } : {}),
  });
}
