import { rm } from "node:fs/promises";
import { writeJson } from "../curate/output.js";
import { poolRelPath, writePool } from "../fetch/pool.js";
import { applySourceResults, toHealthFile } from "../state/sourceHealth.js";
import { writeSourceHealth } from "../state/store.js";
import { StageFailure } from "./errors.js";
import { gatherPool } from "./gatherPool.js";
import { markStage, type Plan, passFile } from "./plan.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

/**
 * Fetch every pass's pool into `.cache/run/<id>/pool.json` and record source health in
 * state/source-health.json (not on a dry run). Source health is written even when the stage then
 * fails, because a run that could not reach any source is exactly what the counters should show.
 * Every source that could run failing is a stage failure: a broken network must not read as a
 * quiet day.
 */
export async function fetchStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const passes: PassReport[] = [];
  for (const pass of plan.passes) {
    const now = deps.now();
    const gathered = await gatherPool({
      root: deps.root,
      now,
      id: pass.id,
      kind: pass.kind,
      window: { from: new Date(pass.window.from), to: new Date(pass.window.to) },
      setup: deps.fetch,
    });
    await writePool(passFile(deps.root, pass.id, "pool.json"), gathered.pool);
    // The general stories live beside the pool, never in it. A file left by an earlier attempt
    // goes when this one read no general source.
    const generalPath = passFile(deps.root, pass.id, "general.json");
    if (gathered.general) await writeJson(generalPath, gathered.general);
    else await rm(generalPath, { force: true });

    if (!plan.dry_run) {
      // Applied pass by pass: a source failing in both passes of one run has failed twice in a row.
      await writeSourceHealth(
        deps.root,
        toHealthFile(applySourceResults(gathered.sources, gathered.results, now)),
      );
    }

    const failed = gathered.results.filter((result) => !result.ok);
    const skipped = gathered.results.filter((result) => result.ok && result.note !== undefined);
    for (const result of failed) {
      deps.log.warn(`source ${result.source_id} failed`, { error: result.error ?? "" });
    }
    const attempted = gathered.results.length - skipped.length;
    if (attempted > 0 && failed.length === attempted) {
      throw new StageFailure(
        `${pass.id}: all ${attempted} sources that could run failed. Check the network and run \`dispatch sources check\`.`,
      );
    }

    await markStage(deps.root, pass, "fetch", { at: now.toISOString() });
    passes.push({
      id: pass.id,
      kind: pass.kind,
      window: gathered.pool.window,
      sources: {
        run: gathered.results.length,
        ok: gathered.results.length - failed.length,
        failed: failed.length,
        skipped: skipped.length,
      },
      failed_sources: failed.map((result) => result.source_id),
      fetched: gathered.pool.report.fetched,
      after_dedupe: gathered.pool.report.dedupe.output,
      kept: gathered.pool.items.length,
      ...(gathered.general ? { general_stories: gathered.general.report.stories } : {}),
      pool: poolRelPath(pass.id),
    });
  }
  return { stage: "fetch", ok: true, dry_run: plan.dry_run, passes };
}
