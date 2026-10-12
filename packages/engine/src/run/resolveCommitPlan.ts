import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { DigestId, zonedDate } from "@dispatch/core";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { Selection } from "../curate/selectionFile.js";
import { loadScheduleZone } from "../schedule/store.js";
import { StageFailure } from "./errors.js";
import { type Plan, passDir, passFile, readPlan, runCacheDir } from "./plan.js";
import type { RunDeps, RunOptions } from "./types.js";

export interface ResolvedPlan {
  plan: Plan;
  /** True when the plan was built from an agent-mode run directory rather than the gate. */
  adopted: boolean;
}

const COMMITTED_MARKER = "committed.json";

async function isCommitted(root: string, id: string): Promise<boolean> {
  return (await readJsonIfExists(passFile(root, id, COMMITTED_MARKER), COMMITTED_MARKER)) !== null;
}

/** Mark an adopted run directory as committed, so the same selection cannot publish twice. */
export async function markAdoptedCommitted(
  root: string,
  id: string,
  at: Date,
  digestIds: readonly string[],
): Promise<void> {
  await writeJson(passFile(root, id, COMMITTED_MARKER), {
    version: 1,
    at: at.toISOString(),
    digests: digestIds,
  });
}

/**
 * Build a one-pass plan from an agent-mode run directory: the session fetched, wrote
 * `agent-selection.json` and ran `dispatch curate --mode agent`, which left a validated
 * `selection.json`. No gate ran, so the run is not tied to the cadence; the selection's own kind
 * decides which record the commit updates.
 */
async function adopt(deps: RunDeps, options: RunOptions, id: string): Promise<ResolvedPlan> {
  if (!DigestId.safeParse(id).success) {
    throw new StageFailure(
      `Run directory "${id}" is not a digest id. Use the id \`dispatch fetch\` printed.`,
    );
  }
  const raw = await readJsonIfExists(passFile(deps.root, id, "selection.json"), "selection.json");
  if (raw === null) {
    throw new StageFailure(
      `No selection.json in .cache/run/${id}. Run \`dispatch curate --mode agent\` first.`,
    );
  }
  const selection = Selection.safeParse(raw);
  if (!selection.success) {
    throw new StageFailure(`.cache/run/${id}/selection.json is invalid. Run curate again.`);
  }
  if (await isCommitted(deps.root, id)) {
    throw new StageFailure(`.cache/run/${id} was already committed. Fetch again for a new run.`);
  }
  const now = deps.now();
  return {
    adopted: true,
    plan: {
      version: 1,
      mode: "on-demand",
      dry_run: options.dryRun,
      created_at: now.toISOString(),
      date: zonedDate(now, await loadScheduleZone(deps.root)),
      reason: `adopted run ${id}`,
      passes: [{ id, kind: selection.data.kind, window: selection.data.window }],
      source: "adopted",
    },
  };
}

/** The newest uncommitted agent-mode selection written after `after`, or null. */
async function findAgentRun(root: string, after: Date | undefined): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(runCacheDir(root));
  } catch {
    return null;
  }
  let best: { id: string; mtime: number } | null = null;
  for (const name of names) {
    if (!DigestId.safeParse(name).success) continue;
    try {
      const info = await stat(join(passDir(root, name), "selection.json"));
      if (after !== undefined && info.mtimeMs <= after.getTime()) continue;
      if (best !== null && info.mtimeMs <= best.mtime) continue;
      const parsed = Selection.safeParse(
        await readJsonIfExists(passFile(root, name, "selection.json"), "selection.json"),
      );
      if (!parsed.success || parsed.data.mode !== "agent" || parsed.data.outcome !== "selected") {
        continue;
      }
      if (await isCommitted(root, name)) continue;
      best = { id: name, mtime: info.mtimeMs };
    } catch {
      // Not a run directory with a selection.
    }
  }
  return best?.id ?? null;
}

/**
 * The plan the commit stage works from:
 *  - `--run <id>` adopts that agent-mode run directory;
 *  - a gate plan with passes is used as written, once;
 *  - otherwise an uncommitted agent-mode selection newer than the last plan is adopted;
 *  - otherwise a gate plan with no passes means "gated".
 */
export async function resolveCommitPlan(deps: RunDeps, options: RunOptions): Promise<ResolvedPlan> {
  if (options.run !== undefined) return adopt(deps, options, options.run);
  const plan = await readPlan(deps.root);
  if (plan !== null && plan.passes.length > 0) {
    if (plan.committed_at !== undefined) {
      throw new StageFailure(
        "This run was already committed. Run the gate stage again to start another.",
      );
    }
    return { plan, adopted: false };
  }
  const agentRun = await findAgentRun(
    deps.root,
    plan === null ? undefined : new Date(plan.created_at),
  );
  if (agentRun !== null) return adopt(deps, options, agentRun);
  if (plan !== null) return { plan, adopted: false };
  throw new StageFailure(
    "No plan found. Run `dispatch run --stage gate` first, or for agent mode run `dispatch curate --mode agent` and then commit.",
  );
}
