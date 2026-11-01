import { activeFitTopics, type JudgmentEntry } from "@singularity/core";
import { loadJudgments, loadPool } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { judgeWithCache, lookupJudgments, mergeJudgments } from "../judge/cache.js";
import type { CombinedRequest } from "../judge/combinedJudge.js";
import { finishTopicJudging, planTopicJudging } from "../judge/topicJudge.js";
import { neutralEntry, topicOnlyTopics } from "../judge/topicOnly.js";
import {
  withBasis,
  withoutStaleJudgments,
  withoutTopicFits,
  withVideoExcerpts,
} from "../judge/videoExcerpt.js";
import { readTopicJudgments } from "../state/store.js";
import { loadTopicsFile } from "../topics/store.js";
import { type JudgedFile, withRunJudgments, withRunTopicJudgments } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import { judgeGeneral } from "./judgeGeneral.js";
import {
  markStage,
  type Plan,
  passFile,
  requireStage,
  runJudgmentsPath,
  runTopicJudgmentsPath,
} from "./plan.js";
import { readSampleFiles, type SampleJudgedFile } from "./scoreSample.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

/** At least this share of a pool going unjudged is an outage, not a quiet day. */
export const OUTAGE_SHARE = 0.5;

export function mostlyFailed(failed: number, total: number): boolean {
  return total > 0 && failed / total >= OUTAGE_SHARE;
}

/**
 * Judge every pass's pool with Jev, falling back to the routed fallback judge for items Jev cannot answer.
 * The cache starts from state/judgments.json plus anything an earlier attempt saved in the run
 * cache; the merged result goes to `.cache/run/judgments.json` and reaches state/ only at commit,
 * so a failed run changes nothing committed. When most of a pool goes unjudged (both judges down)
 * the stage fails instead of letting the run record a quiet day and lose the window.
 *
 * After the category judgment, each enabled custom topic is asked about the items that pass its
 * cost gate (a keyword match, or a tagged source or query). Those fits live in their own cache and
 * in the pass's judged.json, and never touch the category judgments. A topic judge that fails does
 * not fail the stage: the affected items simply score on their built-in categories.
 */
export async function judgeStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const runtime = await deps.runtime();
  const cachePath = runJudgmentsPath(deps.root);
  let cache = await withRunJudgments(await loadJudgments(deps.root), cachePath);

  // Built-in weights do not matter here, so a repository without topics.json needs nothing else.
  const topicsFile = await loadTopicsFile(deps.root);
  const customTopics = topicsFile ? activeFitTopics(topicsFile) : [];
  const topicJudge = customTopics.length > 0 ? (runtime.topicJudge ?? null) : null;
  if (customTopics.length > 0 && topicJudge === null) {
    deps.log.warn("Custom topics are set but TYPESAFE_API_KEY is not; they are skipped this run", {
      topics: customTopics.length,
    });
  }
  const topicCachePath = runTopicJudgmentsPath(deps.root);
  let topicCache = await withRunTopicJudgments(await readTopicJudgments(deps.root), topicCachePath);

  const passes: PassReport[] = [];
  let outage: string | undefined;
  // The caches are saved even when a pass throws (a budget error, a crash): the answers an earlier
  // pass already paid for must not be asked again by the next attempt (REL-03).
  try {
    for (const pass of plan.passes) {
      await requireStage(deps.root, pass, "fetch", "judging");
      const loaded = await loadPool(passFile(deps.root, pass.id, "pool.json"));
      const now = deps.now();
      // A favorite creator's video is judged on what it says, not on its description (D255), so an
      // entry cached from the description or from another excerpt is dropped and asked again.
      const spoken = await withVideoExcerpts(loaded.items, runtime.extract, deps.log);
      const fresh = withoutStaleJudgments(cache, spoken.basis);
      cache = fresh.cache;
      topicCache = withoutTopicFits(topicCache, fresh.stale);
      const pool = { ...loaded, items: spoken.items };
      // Jev takes one item per request, so what an item needs is asked in one request: the six main
      // questions and its topic fits together, only the fits for an item a coverage topic decides
      // alone, only the six for everything else. Cached answers are never asked again.
      const lookup = lookupJudgments(cache, pool.items, runtime.judge);
      const topicOnly = new Set<string>();
      if (topicJudge !== null) {
        for (const item of lookup.misses) {
          if (topicOnlyTopics(item, customTopics).length > 0) topicOnly.add(item.id);
        }
      }
      const topicPlan =
        topicJudge !== null
          ? planTopicJudging(topicJudge.model, pool.items, customTopics, topicCache)
          : null;
      const combo: CombinedRequest[] = [];
      if (topicPlan !== null && runtime.combinedJudge) {
        const requestFor = new Map(topicPlan.requests.map((request) => [request.item.id, request]));
        for (const item of lookup.misses) {
          const request = requestFor.get(item.id);
          if (!topicOnly.has(item.id) && request) combo.push({ item, topics: request.topics });
        }
      }
      const comboIds = new Set(combo.map((request) => request.item.id));
      const combined =
        combo.length > 0 && runtime.combinedJudge
          ? await runtime.combinedJudge.judge(combo)
          : { entries: [], topicEntries: [] };
      const topicOnlyRequests = (topicPlan?.requests ?? []).filter(
        (request) => !comboIds.has(request.item.id),
      );
      const freshTopic =
        topicJudge !== null && topicOnlyRequests.length > 0
          ? await topicJudge.judge(topicOnlyRequests)
          : [];

      const rest = pool.items.filter((item) => !topicOnly.has(item.id) && !comboIds.has(item.id));
      const judged = await judgeWithCache(runtime.judge, rest, cache);
      cache = mergeJudgments(judged.cache, combined.entries);

      const topics =
        topicPlan !== null
          ? finishTopicJudging(topicPlan, [...combined.topicEntries, ...freshTopic], topicCache)
          : null;
      if (topics !== null) topicCache = topics.cache;

      const byId = new Map<string, JudgmentEntry>();
      const marked: JudgmentEntry[] = [];
      for (const answer of [...judged.entries, ...combined.entries]) {
        const entry = withBasis(answer, spoken.basis);
        byId.set(entry.item_id, entry);
        if (entry !== answer) marked.push(entry);
      }
      cache = mergeJudgments(cache, marked);
      const neutralIds: string[] = [];
      for (const item of pool.items) {
        // Only a story the topic actually scored stands in; one it could not reach is retried next run.
        const fit = topics?.fits[item.id];
        const decided = topicOnlyTopics(item, customTopics).some(
          (topic) => fit?.[topic.id] !== undefined,
        );
        if (topicOnly.has(item.id) && decided) {
          byId.set(
            item.id,
            neutralEntry(item, {
              model: runtime.judge.model,
              questionsHash: runtime.judge.questionsHash,
              now,
            }),
          );
          neutralIds.push(item.id);
        }
      }
      const entries = pool.items.flatMap((item) => byId.get(item.id) ?? []);
      const unjudged = pool.items.filter((item) => !byId.has(item.id)).map((item) => item.id);

      const fallback = entries.filter((entry) => entry.model !== runtime.judge.model).length;
      if (fallback > 0) {
        deps.log.warn("The fallback judge answered some items; its probabilities are coarser", {
          pass: pass.id,
          items: fallback,
        });
      }
      const file: JudgedFile = {
        version: 1,
        judge: {
          name: runtime.judge.name,
          model: runtime.judge.model,
          questions_hash: runtime.judge.questionsHash,
        },
        entries,
        unjudged,
        counts: {
          pool: pool.items.length,
          cache_hits: judged.hitCount,
          fresh: judged.missCount - judged.unjudged.length + combined.entries.length,
          unjudged: unjudged.length,
          fallback,
        },
      };
      // Only items a judge actually asked count toward a source's trust (run/sourceCounts.ts).
      if (neutralIds.length > 0) file.neutral_ids = neutralIds;
      let topicReport: Record<string, number> | undefined;
      if (topics !== null) {
        file.topic_fits = topics.fits;
        topicReport = {
          topic_items: topics.gated,
          topic_cache_hits: topics.hits,
          topic_fresh: topics.asked,
          topic_unanswered: topics.unanswered,
          topic_only: topicOnly.size,
          combined_requests: combo.length,
        };
      }
      await writeJson(passFile(deps.root, pass.id, "judged.json"), file);

      if (mostlyFailed(file.counts.unjudged, file.counts.pool)) {
        outage ??= `${pass.id}: the judges answered ${file.entries.length} of ${file.counts.pool} items. That looks like an outage, not a quiet day.`;
        continue;
      }
      // The general news stories are judged apart from the pool, for their feeds' scores only, so
      // nothing that goes wrong with them may stop the briefing.
      let generalReport: Awaited<ReturnType<typeof judgeGeneral>> = null;
      try {
        generalReport = await judgeGeneral(
          deps,
          pass,
          runtime,
          topicsFile,
          plan.passes
            .slice(0, plan.passes.indexOf(pass))
            .map((earlier) => passFile(deps.root, earlier.id, "general-judged.json")),
        );
      } catch (error) {
        deps.log.warn("The general news stories could not be judged; the briefing goes on", {
          pass: pass.id,
          reason: error instanceof Error ? error.message.split("\n")[0] : "unknown",
        });
      }
      // The scoring sample (D70) is judged for its sources' scores alone, on the built-in questions,
      // and like the general stories it may never stop the briefing.
      let sampleReport: Record<string, number> | undefined;
      try {
        const { sample } = await readSampleFiles(
          passFile(deps.root, pass.id, "sample.json"),
          passFile(deps.root, pass.id, "sample-judged.json"),
        );
        const sampleJudge = runtime.sampleJudge ?? null;
        if (sample && sampleJudge === null) {
          deps.log.warn("No Jev client: the scoring sample waits for a run that has one", {
            pass: pass.id,
            items: sample.items.length,
          });
        }
        // Written even with no items, so the feed reads that found none still count as done.
        if (sample && sampleJudge !== null) {
          const answered = await judgeWithCache(sampleJudge, sample.items, cache);
          cache = answered.cache;
          const judgedSample: SampleJudgedFile = {
            version: 1,
            entries: answered.entries,
            unjudged: answered.unjudged,
          };
          await writeJson(passFile(deps.root, pass.id, "sample-judged.json"), judgedSample);
          sampleReport = {
            sample_items: sample.items.length,
            sample_fresh: answered.missCount - answered.unjudged.length,
            sample_unjudged: answered.unjudged.length,
          };
        }
      } catch (error) {
        deps.log.warn("The scoring sample could not be judged; the briefing goes on", {
          pass: pass.id,
          reason: error instanceof Error ? error.message.split("\n")[0] : "unknown",
        });
      }
      await markStage(deps.root, pass, "judge", { at: deps.now().toISOString() });
      passes.push({
        id: pass.id,
        kind: pass.kind,
        judge: file.judge.name,
        model: file.judge.model,
        ...file.counts,
        ...topicReport,
        ...generalReport,
        ...sampleReport,
      });
    }
  } finally {
    await writeJson(cachePath, cache);
    if (customTopics.length > 0) await writeJson(topicCachePath, topicCache);
  }
  if (outage !== undefined) throw new StageFailure(outage);
  return { stage: "judge", ok: true, dry_run: plan.dry_run, passes };
}
