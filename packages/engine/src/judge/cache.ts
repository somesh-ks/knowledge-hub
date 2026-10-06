import type { Item, JudgmentEntry, JudgmentsFile } from "@dispatch/core";
import type { Judge } from "./types.js";

/** Judgments are pruned after 30 days, per the state-file contract. */
export const JUDGMENT_MAX_AGE_DAYS = 30;

export function judgmentKey(itemId: string, questionsHash: string, model: string): string {
  return `${itemId}:${questionsHash}:${model}`;
}

export interface CacheLookup {
  /** Cached entries, in item order. */
  hits: JudgmentEntry[];
  /** Items with no entry for this judge's questions and model. */
  misses: Item[];
}

/** Split items into cache hits and misses for one judge. Pure: the cache is plain data. */
export function lookupJudgments(
  cache: JudgmentsFile,
  items: readonly Item[],
  judge: Pick<Judge, "questionsHash" | "model">,
): CacheLookup {
  const hits: JudgmentEntry[] = [];
  const misses: Item[] = [];
  for (const item of items) {
    const entry = cache.entries[judgmentKey(item.id, judge.questionsHash, judge.model)];
    if (entry) hits.push(entry);
    else misses.push(item);
  }
  return { hits, misses };
}

/** A new cache with the entries added, keyed by each entry's own id, hash and model. */
export function mergeJudgments(
  cache: JudgmentsFile,
  entries: readonly JudgmentEntry[],
): JudgmentsFile {
  const merged = { ...cache.entries };
  for (const entry of entries) {
    merged[judgmentKey(entry.item_id, entry.questions_hash, entry.model)] = entry;
  }
  return { version: 1, entries: merged };
}

/** Drop entries judged more than `maxAgeDays` before `now`. */
export function pruneJudgments(
  cache: JudgmentsFile,
  now: Date,
  maxAgeDays: number = JUDGMENT_MAX_AGE_DAYS,
): JudgmentsFile {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const kept = Object.entries(cache.entries).filter(
    ([, entry]) => Date.parse(entry.judged_at) >= cutoff,
  );
  return { version: 1, entries: Object.fromEntries(kept) };
}

export interface CachedJudgeResult {
  /** One entry per judged item, in input order. Items that failed have none. */
  entries: JudgmentEntry[];
  cache: JudgmentsFile;
  hitCount: number;
  missCount: number;
  /** Ids the judge could not answer. */
  unjudged: string[];
}

/** Judge only what the cache lacks, then merge. Weight changes re-score from the cache with no calls. */
export async function judgeWithCache(
  judge: Judge,
  items: readonly Item[],
  cache: JudgmentsFile,
): Promise<CachedJudgeResult> {
  const { hits, misses } = lookupJudgments(cache, items, judge);
  const fresh = misses.length > 0 ? await judge.judge(misses) : [];
  const merged = mergeJudgments(cache, fresh);
  const byId = new Map<string, JudgmentEntry>();
  for (const entry of [...hits, ...fresh]) byId.set(entry.item_id, entry);
  const entries = items
    .map((item) => byId.get(item.id))
    .filter((e): e is JudgmentEntry => e !== undefined);
  return {
    entries,
    cache: merged,
    hitCount: hits.length,
    missCount: misses.length,
    unjudged: items.filter((item) => !byId.has(item.id)).map((item) => item.id),
  };
}
