import { stockholmDate } from "@dispatch/core";
import { commitAndPush } from "../git/commit.js";
import { recordFailure } from "../state/runRecord.js";
import { readLastRun, writeLastRun } from "../state/store.js";
import { decideKinds } from "./gate.js";
import { readPlan } from "./plan.js";
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
 * before the gate) the gate is asked again. Nothing is recorded for a dry run, a replacement or
 * an on-demand run (they leave the cadence alone, so `run_died` still reports them), for a run
 * that was not due, or once the commit stage has committed.
 */
export async function recordFailedRun(deps: RunDeps, options: RunOptions): Promise<CommitReport> {
  const now = deps.now();
  const plan = await readPlan(deps.root).catch(() => null);
  const skip = (reason: string) => report(reason, { status: "nothing_to_commit" });
  if (plan?.committed_at !== undefined) return skip("The commit stage already committed this run.");
  if (plan?.dry_run || options.dryRun) return skip("A dry run records nothing.");
  if (plan?.replaces !== undefined || options.replace !== undefined) {
    return skip("A replacement records nothing.");
  }
  if ((plan?.mode ?? options.mode) === "on-demand")
    return skip("An on-demand run records nothing.");

  const kinds = plan
    ? plan.passes.map((pass) => pass.kind)
    : (await decideKinds(deps, options, now)).kinds;
  if (kinds.length === 0) return skip("Nothing was due, so nothing was lost.");

  const at = now.toISOString();
  await writeLastRun(deps.root, recordFailure(await readLastRun(deps.root), kinds, at));
  const message = `chore(state): run ${stockholmDate(now)} failed`;
  const committed = await commitAndPush({
    root: deps.root,
    message,
    command: "run",
    configStore: deps.configStore === true,
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
