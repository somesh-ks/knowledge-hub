import { rm } from "node:fs/promises";
import { stockholmDate } from "@dispatch/core";
import { loadJudgments } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { poolRelPath, writePool } from "../fetch/pool.js";
import type { SourceResult } from "../fetch/types.js";
import { loadSources } from "../sources/registry.js";
import { applySourceResults, overlayHealth, toHealthFile } from "../state/sourceHealth.js";
import { readSeen, readSourceHealth, readSourceStats, writeSourceHealth } from "../state/store.js";
import { withRunJudgments } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import { type GatherResult, gatherPool } from "./gatherPool.js";
import { markStage, type Plan, type PlanPass, passFile, runJudgmentsPath } from "./plan.js";
import {
  answeredBefore,
  pickSample,
  planReads,
  type ReadPlan,
  readFeeds,
  type SampleFile,
} from "./scoreSample.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

/** The read plan of the run's scoring sample (D70), or null when it cannot be made. */
async function planSample(deps: RunDeps, now: Date): Promise<ReadPlan | null> {
  try {
    const [registry, stats, health] = await Promise.all([
      loadSources(deps.root),
      readSourceStats(deps.root),
      readSourceHealth(deps.root),
    ]);
    const sources = overlayHealth(registry, health).sources;
    return planReads({ sources, stats, today: stockholmDate(now), now });
  } catch (error) {
    deps.log.warn("The scoring sample could not be planned; scores wait for the next run", {
      reason: error instanceof Error ? error.message.split("\n")[0] : "unknown",
    });
    return null;
  }
}

/**
 * Build the pass's scoring sample: read the planned feeds, then pick what to judge for the score
 * alone. A switched-off source's read also returns its fetch result, for its health. Nothing that
 * goes wrong here may stop the briefing: it is logged, and the run goes on without a sample.
 */
async function buildSample(
  deps: RunDeps,
  pass: PlanPass,
  readPlan: ReadPlan,
  gathered: GatherResult,
  now: Date,
): Promise<{ file: SampleFile; probeResults: SourceResult[]; reads: number } | null> {
  try {
    const [stats, seen, cache] = await Promise.all([
      readSourceStats(deps.root),
      readSeen(deps.root),
      loadJudgments(deps.root).then((base) => withRunJudgments(base, runJudgmentsPath(deps.root))),
    ]);
    const { items, results } = await readFeeds(readPlan.reads, {
      http: deps.fetch.http,
      now,
      fetchers: deps.fetch.fetchers,
    });
    const answered = answeredBefore(cache, seen);
    const pooled = new Set(gathered.pool.items.map((item) => item.id));
    const picked = pickSample({
      sources: gathered.sources.sources,
      stats,
      leftovers: gathered.leftovers,
      reads: readPlan.reads,
      read: items,
      known: (id) => pooled.has(id) || answered(id),
    });
    // A refill that failed tries again next run; a weekly check counts as done either way, and its
    // failure shows in the source's health.
    const ok = new Set(results.filter((result) => result.ok).map((result) => result.source_id));
    const probes = new Set(
      readPlan.reads.filter((read) => read.reason === "probe").map((read) => read.source.id),
    );
    const reads = [
      ...readPlan.reads
        .filter((read) => read.reason === "probe" || ok.has(read.source.id))
        .map((read) => read.source.id),
      // A switched-off general feed counts as checked only if the pass read it: one whose topics
      // are all off was left out.
      ...readPlan.probeGeneral
        .map((source) => source.id)
        .filter((id) => gathered.results.some((result) => result.source_id === id)),
    ];
    return {
      file: { version: 1, items: picked, reads },
      probeResults: results.filter((result) => probes.has(result.source_id)),
      reads: readPlan.reads.length,
    };
  } catch (error) {
    deps.log.warn("The scoring sample failed; the briefing goes on without it", {
      pass: pass.id,
      reason: error instanceof Error ? error.message.split("\n")[0] : "unknown",
    });
    return null;
  }
}

/**
 * Fetch every pass's pool into `.cache/run/<id>/pool.json` and record source health in
 * state/source-health.json (not on a dry run). Source health is written even when the stage then
 * fails, because a run that could not reach any source is exactly what the counters should show.
 * Every source that could run failing is a stage failure: a broken network must not read as a
 * quiet day.
 */
export async function fetchStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const passes: PassReport[] = [];
  // The scoring sample (D70) rides on the run's first regular pass, once a run.
  const samplePass = plan.passes.find((pass) => pass.kind === "regular");
  const readPlan = samplePass ? await planSample(deps, deps.now()) : null;
  for (const pass of plan.passes) {
    const now = deps.now();
    const sampling = pass === samplePass && readPlan !== null;
    const gathered = await gatherPool({
      root: deps.root,
      now,
      id: pass.id,
      kind: pass.kind,
      window: { from: new Date(pass.window.from), to: new Date(pass.window.to) },
      setup: deps.fetch,
      ...(sampling ? { probeGeneral: readPlan.probeGeneral } : {}),
    });
    await writePool(passFile(deps.root, pass.id, "pool.json"), gathered.pool);
    // The general stories live beside the pool, never in it. A file left by an earlier attempt
    // goes when this one read no general source.
    const generalPath = passFile(deps.root, pass.id, "general.json");
    if (gathered.general) await writeJson(generalPath, gathered.general);
    else await rm(generalPath, { force: true });

    const samplePath = passFile(deps.root, pass.id, "sample.json");
    const sample = sampling ? await buildSample(deps, pass, readPlan, gathered, now) : null;
    if (sample) await writeJson(samplePath, sample.file);
    else await rm(samplePath, { force: true });

    if (!plan.dry_run) {
      // Applied pass by pass: a source failing in both passes of one run has failed twice in a row.
      // A switched-off source the sample checked has its health from that read alone.
      await writeSourceHealth(
        deps.root,
        toHealthFile(
          applySourceResults(
            gathered.sources,
            [...gathered.results, ...(sample?.probeResults ?? [])],
            now,
          ),
        ),
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
      ...(sample ? { sample_items: sample.file.items.length, sample_reads: sample.reads } : {}),
      pool: poolRelPath(pass.id),
    });
  }
  return { stage: "fetch", ok: true, dry_run: plan.dry_run, passes };
}
