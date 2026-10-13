import { type DigestKind, scheduleZone } from "@dispatch/core";
import { allocateDigestId } from "../gate/allocateDigestId.js";
import { decideRun } from "../gate/decideRun.js";
import { fetchWindow } from "../gate/fetchWindow.js";
import { loadSchedule } from "../schedule/store.js";
import { listDigestIds } from "../state/digestIds.js";
import { readLastRun } from "../state/store.js";
import { UsageError } from "./errors.js";
import { releaseSeen, replacementPass } from "./replace.js";
import { newPassState, type Plan, type PlanPass, writePassState, writePlan } from "./plan.js";
import type { GateReport, RunDeps, RunOptions } from "./types.js";

/** `--since` as a Date, or a usage error: it must be a real instant that is not in the future. */
export function parseSince(since: string, now: Date): Date {
  const from = new Date(since);
  if (Number.isNaN(from.getTime()) || from > now) {
    throw new UsageError("--since must be an ISO date or time in the past");
  }
  return from;
}

/**
 * The gate: decide whether a run is due and which digests it produces, then write the plan every
 * later stage reads. A regular or on-demand digest comes first; at the weekly day and hour of
 * config/schedule.json (in its time zone) the weekly pass follows it, and weekly mode runs the weekly
 * pass alone. `due` is true when there is
 * at least one pass, so a weekly-only run still starts the later workflow steps.
 */
export async function gateStage(deps: RunDeps, options: RunOptions): Promise<GateReport> {
  if (options.replace !== undefined) return replaceGate(deps, options, options.replace);
  const now = deps.now();
  const [lastRun, schedule] = await Promise.all([readLastRun(deps.root), loadSchedule(deps.root)]);
  const decision = decideRun({
    now,
    mode: options.mode,
    lastRun,
    force: options.force,
    cadenceDays: schedule.cadence_days,
    weekly: schedule.weekly,
    zone: scheduleZone(schedule.timezone),
  });
  const since = options.since === undefined ? undefined : parseSince(options.since, now);
  const lastFetchAt = lastRun.last_fetch_at ? new Date(lastRun.last_fetch_at) : undefined;

  const kinds: DigestKind[] = [];
  if (decision.due) kinds.push(options.mode === "on-demand" ? "on-demand" : "regular");
  if (decision.runWeekly) kinds.push("weekly");

  // Ids are allocated against what is on disk and against each other, so two passes never collide
  // and a second run on the same day takes the next free suffix.
  const taken = new Set(await listDigestIds(deps.root));
  const passes: PlanPass[] = kinds.map((kind) => {
    const id = allocateDigestId(decision.date, kind, taken);
    taken.add(id);
    const window = fetchWindow({ lastFetchAt, now, kind });
    return {
      id,
      kind,
      window: {
        from: (since ?? window.from).toISOString(),
        to: window.to.toISOString(),
      },
    };
  });

  const plan: Plan = {
    version: 1,
    mode: options.mode,
    dry_run: options.dryRun,
    created_at: now.toISOString(),
    date: decision.date,
    reason: decision.reason,
    passes,
    source: "gate",
  };
  await writePlan(deps.root, plan);
  // A fresh run starts with no stage done, even when the same id was planned before.
  for (const pass of passes) await writePassState(deps.root, newPassState(pass));

  deps.log.info(passes.length > 0 ? "A run is due" : "No run is due", {
    reason: decision.reason,
    passes: passes.map((pass) => `${pass.id} (${pass.kind})`),
  });
  return {
    due: passes.length > 0,
    reason: decision.reason,
    mode: options.mode,
    passes,
    dry_run: options.dryRun,
  };
}

/**
 * Regenerate on a briefing: one pass with the old digest's id, kind and date, over its own window up
 * to now, whatever the cadence says. The old digest stays until the commit stage publishes the new one.
 */
async function replaceGate(deps: RunDeps, options: RunOptions, id: string): Promise<GateReport> {
  const { pass, date, mode, itemIds } = await replacementPass(deps, id);
  const plan: Plan = {
    version: 1,
    mode,
    dry_run: options.dryRun,
    created_at: deps.now().toISOString(),
    date,
    reason: `replacing ${id}`,
    passes: [pass],
    source: "gate",
    replaces: pass.id,
  };
  await writePlan(deps.root, plan);
  await writePassState(deps.root, newPassState(pass));
  if (!options.dryRun) await releaseSeen(deps.root, itemIds);
  deps.log.info("A replacement run", { id });
  return { due: true, reason: plan.reason, mode, passes: [pass], dry_run: options.dryRun };
}
