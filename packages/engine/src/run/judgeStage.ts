import { loadJudgments, loadPool } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { judgeWithCache } from "../judge/cache.js";
import { type JudgedFile, withRunJudgments } from "./artifacts.js";
import { StageFailure } from "./errors.js";
import { markStage, type Plan, passFile, requireStage, runJudgmentsPath } from "./plan.js";
import type { PassReport, RunDeps, StageReport } from "./types.js";

/** At least this share of a pool going unjudged is an outage, not a quiet day. */
export const OUTAGE_SHARE = 0.5;

export function mostlyFailed(failed: number, total: number): boolean {
  return total > 0 && failed / total >= OUTAGE_SHARE;
}

/**
 * Judge every pass's pool with Jev, falling back to the Nebius judge for items Jev cannot answer.
 * The cache starts from state/judgments.json plus anything an earlier attempt saved in the run
 * cache; the merged result goes to `.cache/run/judgments.json` and reaches state/ only at commit,
 * so a failed run changes nothing committed. When most of a pool goes unjudged (both judges down)
 * the stage fails instead of letting the run record a quiet day and lose the window.
 */
export async function judgeStage(deps: RunDeps, plan: Plan): Promise<StageReport> {
  const runtime = await deps.runtime();
  const cachePath = runJudgmentsPath(deps.root);
  let cache = await withRunJudgments(await loadJudgments(deps.root), cachePath);

  const passes: PassReport[] = [];
  let outage: string | undefined;
  for (const pass of plan.passes) {
    await requireStage(deps.root, pass, "fetch", "judging");
    const pool = await loadPool(passFile(deps.root, pass.id, "pool.json"));
    const judged = await judgeWithCache(runtime.judge, pool.items, cache);
    cache = judged.cache;

    const fallback = judged.entries.filter((entry) => entry.model !== runtime.judge.model).length;
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
      entries: judged.entries,
      unjudged: judged.unjudged,
      counts: {
        pool: pool.items.length,
        cache_hits: judged.hitCount,
        fresh: judged.missCount - judged.unjudged.length,
        unjudged: judged.unjudged.length,
        fallback,
      },
    };
    await writeJson(passFile(deps.root, pass.id, "judged.json"), file);

    if (mostlyFailed(file.counts.unjudged, file.counts.pool)) {
      outage ??= `${pass.id}: the judges answered ${file.entries.length} of ${file.counts.pool} items. That looks like an outage, not a quiet day.`;
      continue;
    }
    await markStage(deps.root, pass, "judge", { at: deps.now().toISOString() });
    passes.push({
      id: pass.id,
      kind: pass.kind,
      judge: file.judge.name,
      model: file.judge.model,
      ...file.counts,
    });
  }
  await writeJson(cachePath, cache);
  if (outage !== undefined) throw new StageFailure(outage);
  return { stage: "judge", ok: true, dry_run: plan.dry_run, passes };
}
