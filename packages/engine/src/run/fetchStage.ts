import { rm } from "node:fs/promises";
import { type SourceStatsFile, stockholmDate, VOICE_LIMITS } from "@singularity/core";
import { loadJudgments } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { poolRelPath, writePool } from "../fetch/pool.js";
import type { SourceResult } from "../fetch/types.js";
import { DEFAULT_CAP } from "../prefilter/prefilter.js";
import {
  createFileProfileStore,
  dropBlocked,
  isBlockedSource,
  OWNER_ID,
} from "../profile/profile.js";
import { loadSchedule } from "../schedule/store.js";
import { loadSources } from "../sources/registry.js";
import { applySourceResults, overlayHealth, toHealthFile } from "../state/sourceHealth.js";
import { readSeen, readSourceHealth, readSourceStats, writeSourceHealth } from "../state/store.js";
import { withRunJudgments } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import { type GatherResult, gatherPool } from "./gatherPool.js";
import { markStage, type Plan, type PlanPass, passFile, runJudgmentsPath } from "./plan.js";
import { lengthMinutesFor, poolCapFor, storiesForMinutes, withSpares } from "./scheduleSize.js";
import {
  answeredBefore,
  pickSample,
  planReads,
  type ReadPlan,
  readFeeds,
  type SampleFile,
} from "./scoreSample.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

interface SamplePlan {
  readPlan: ReadPlan;
  stats: SourceStatsFile;
}

/** The read plan of the run's scoring sample (D70), or null when it cannot be made. */
async function planSample(deps: RunDeps, now: Date): Promise<SamplePlan | null> {
  try {
    const [registry, stats, health, profile] = await Promise.all([
      loadSources(deps.root),
      readSourceStats(deps.root),
      readSourceHealth(deps.root),
      createFileProfileStore(deps.root).read(OWNER_ID),
    ]);
    // A blocked outlet is not read for the sample either.
    const sources = overlayHealth(registry, health).sources.filter(
      (source) => !isBlockedSource(source, profile.blocked_domains),
    );
    return { readPlan: planReads({ sources, stats, today: stockholmDate(now), now }), stats };
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
  planned: SamplePlan,
  gathered: GatherResult,
  reading: ReturnType<typeof readFeeds>,
): Promise<{ file: SampleFile; probeResults: SourceResult[]; reads: number } | null> {
  const { readPlan, stats } = planned;
  try {
    const [seen, cache, { items, results }] = await Promise.all([
      readSeen(deps.root),
      loadJudgments(deps.root).then((base) => withRunJudgments(base, runJudgmentsPath(deps.root))),
      reading,
    ]);
    const answered = answeredBefore(cache, seen);
    const pooled = new Set(gathered.pool.items.map((item) => item.id));
    const picked = pickSample({
      sources: gathered.sources.sources,
      stats,
      leftovers: gathered.leftovers,
      reads: readPlan.reads,
      read: new Map(
        [...items].map(([id, list]) => [
          id,
          dropBlocked(list, gathered.blockedDomains, (item) => item.url).kept,
        ]),
      ),
      known: (id) => pooled.has(id) || answered(id),
    });
    // A refill that failed tries again next run; a weekly check counts as done either way, and its
    // failure shows in the source's health.
    const ok = new Set(results.filter((result) => result.ok).map((result) => result.source_id));
    const probes = new Set(
      readPlan.reads.filter((read) => read.reason === "probe").map((read) => read.source.id),
    );
    // Every feed read that worked records how many posts its look-back held, a weekly check as
    // much as a refill, so the count and the date of the read move together (sourceScore).
    const counted = readPlan.reads.filter((read) => ok.has(read.source.id));
    const reads = readPlan.reads
      .filter((read) => read.reason === "probe" || ok.has(read.source.id))
      .map((read) => read.source.id);
    // A switched-off general feed the pass tried, with how many stories it gave: the check is the
    // read, done for the week whatever came of it (a failure shows in its health), and its stories
    // are judged with the general ones as the ceiling allows. One whose topics are all off was
    // not tried.
    const generalReads = Object.fromEntries(
      readPlan.probeGeneral.flatMap((source) => {
        const result = gathered.results.find((r) => r.source_id === source.id);
        return result ? [[source.id, result.count]] : [];
      }),
    );
    // How many posts each feed held: under ten, the source posts rarely (sourceScore).
    const feedPosts = Object.fromEntries(
      counted.map((read) => [read.source.id, items.get(read.source.id)?.length ?? 0]),
    );
    return {
      file: {
        version: 1,
        items: picked,
        reads,
        feed_posts: feedPosts,
        general_reads: generalReads,
      },
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
  // The scoring sample (D70) rides on the run's first regular pass, once a run, when Jev can judge
  // it.
  const samplePass =
    deps.fetch.sampleJudge === false
      ? undefined
      : plan.passes.find((pass) => pass.kind === "regular");
  const planned = samplePass ? await planSample(deps, deps.now()) : null;
  const schedule = await loadSchedule(deps.root);
  for (const pass of plan.passes) {
    const now = deps.now();
    const sampling = pass === samplePass && planned !== null;
    // The sample's own feed reads need nothing from the pool, so they run beside the pass's fetch.
    // readFeeds never rejects: each read's failure is its result.
    const reading =
      sampling && planned
        ? readFeeds(planned.readPlan.reads, {
            http: deps.fetch.http,
            now,
            fetchers: deps.fetch.fetchers,
          })
        : null;
    const gathered = await gatherPool({
      root: deps.root,
      now,
      id: pass.id,
      kind: pass.kind,
      window: { from: new Date(pass.window.from), to: new Date(pass.window.to) },
      setup: deps.fetch,
      ...(sampling && planned ? { probeGeneral: planned.readPlan.probeGeneral } : {}),
      ...poolCapOf(lengthMinutesFor(schedule, pass.kind, plan.mode, plan.length_minutes)),
    });
    await writePool(passFile(deps.root, pass.id, "pool.json"), gathered.pool);
    // The general stories live beside the pool, never in it. A file left by an earlier attempt
    // goes when this one read no general source.
    const generalPath = passFile(deps.root, pass.id, "general.json");
    if (gathered.general) await writeJson(generalPath, gathered.general);
    else await rm(generalPath, { force: true });

    const samplePath = passFile(deps.root, pass.id, "sample.json");
    const sample =
      planned && reading ? await buildSample(deps, pass, planned, gathered, reading) : null;
    if (sample) await writeJson(samplePath, sample.file);
    else await rm(samplePath, { force: true });
    // Answers an earlier attempt judged belong to its sample, never this one.
    await rm(passFile(deps.root, pass.id, "sample-judged.json"), { force: true });

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
        `${pass.id}: all ${attempted} sources that could run failed. Check the network and run \`singularity sources check\`.`,
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
      // Read through Firecrawl because YouTube refused the runner (fetchAll's relay).
      relayed_sources: gathered.results
        .filter((result) => result.via === "firecrawl")
        .map((result) => result.source_id),
      fetched: gathered.pool.report.fetched,
      blocked: gathered.blocked,
      after_dedupe: gathered.pool.report.dedupe.output,
      kept: gathered.pool.items.length,
      ...(gathered.general ? { general_stories: gathered.general.report.stories } : {}),
      ...(sample ? { sample_items: sample.file.items.length, sample_reads: sample.reads } : {}),
      pool: poolRelPath(pass.id),
    });
  }
  return { stage: "fetch", ok: true, dry_run: plan.dry_run, passes };
}

/**
 * A pass sized by a length sends the judge candidates in proportion to the stories it writes, so a
 * 15-minute weekly is not chosen from the pool of a five-minute daily.
 */
function poolCapOf(minutes: number | null): { poolCap?: number } {
  if (minutes === null) return {};
  const wanted = storiesForMinutes(minutes, VOICE_LIMITS.items.floor, VOICE_LIMITS.items.hardMax);
  return { poolCap: poolCapFor(withSpares(wanted), DEFAULT_CAP) };
}
