import type { Item, Preferences, Source, SourceType } from "@dispatch/core";
import { authorMatches, containsPhrase, keywordRegExp } from "./phrase.js";
import { releaseWeight } from "./releaseWeight.js";

export const DEFAULT_CAP = 60;
/** HN points above which an item stays even with no keyword or author match. */
export const STRONG_HN_POINTS = 100;

/**
 * Items one source may contribute, so a high-volume feed (a monorepo's releases, a journal's
 * weekly batch) cannot fill the pool. Overridden per source with `options.pool_cap`.
 */
const SOURCE_CAP_BY_TYPE: Partial<Record<SourceType, number>> = {
  github: 4,
  exa: 25,
  hn: 15,
  producthunt: 10,
  lobsters: 10,
};
const DEFAULT_SOURCE_CAP = 8;

const DAY_MS = 86_400_000;
const RECENCY_DAYS = 7;

export interface PrefilterInput {
  items: readonly Item[];
  preferences: Preferences;
  sources: readonly Source[];
  now: Date;
  cap?: number;
}

export interface PrefilterReport {
  input: number;
  kept: number;
  dropped: {
    /** Matched a disliked pattern. */
    disliked: number;
    /** No keyword, author, high-signal source or strong signal. */
    not_relevant: number;
    /** Over the per-source limit. */
    source_cap: number;
    /** Relevant, but below the overall cap. */
    cap: number;
  };
}

export interface PrefilterResult {
  /** Best first. */
  items: Item[];
  report: PrefilterReport;
}

interface Scored {
  item: Item;
  score: number;
}

function sourceCap(source: Source | undefined): number {
  const override = Number(source?.options.pool_cap);
  if (Number.isInteger(override) && override > 0) return override;
  return (source && SOURCE_CAP_BY_TYPE[source.type]) || DEFAULT_SOURCE_CAP;
}

/**
 * Cheap, deterministic triage before any model is involved. Hard-drops disliked patterns, keeps
 * what matches a preferred keyword or author, comes from a high-signal source or carries strong
 * votes, then ranks and caps. The same inputs always give the same output, in the same order.
 */
export function prefilter({
  items,
  preferences,
  sources,
  now,
  cap = DEFAULT_CAP,
}: PrefilterInput): PrefilterResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const keywords = preferences.preferred_keywords.map((keyword) => keywordRegExp(keyword));
  const report: PrefilterReport = {
    input: items.length,
    kept: 0,
    dropped: { disliked: 0, not_relevant: 0, source_cap: 0, cap: 0 },
  };

  const scored: Scored[] = [];
  for (const item of items) {
    const text = `${item.title} ${item.snippet}`;
    if (preferences.disliked_patterns.some((pattern) => containsPhrase(text, pattern))) {
      report.dropped.disliked++;
      continue;
    }

    const source = sourceById.get(item.source_id);
    const titleHits = keywords.filter((re) => re.test(item.title)).length;
    const snippetHits = keywords.filter(
      (re) => !re.test(item.title) && re.test(item.snippet),
    ).length;
    const authorHit = preferences.preferred_authors.some((name) =>
      authorMatches(item.author, name),
    );
    const highSignal = source?.high_signal === true;
    const hnPoints = item.signals.hn_points ?? 0;
    const strong = hnPoints > STRONG_HN_POINTS;

    if (titleHits + snippetHits === 0 && !authorHit && !highSignal && !strong) {
      report.dropped.not_relevant++;
      continue;
    }

    const hint = source?.category_hint;
    const categoryWeight = hint ? preferences.weights[hint] : 0.5;
    const ageDays = item.published_at
      ? (now.getTime() - Date.parse(item.published_at)) / DAY_MS
      : RECENCY_DAYS;
    const recency = Math.max(0, 1 - Math.max(0, ageDays) / RECENCY_DAYS);
    const votes =
      Math.min(3, Math.log10(1 + hnPoints)) +
      Math.min(2, Math.log10(1 + Math.max(0, item.signals.lobsters_score ?? 0)));
    const score =
      3 * titleHits +
      snippetHits +
      (authorHit ? 4 : 0) +
      (highSignal ? 3 : 0) +
      votes +
      2 * categoryWeight +
      recency +
      releaseWeight(item);
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const perSource = new Map<string, number>();
  const withinSourceCaps: Scored[] = [];
  for (const entry of scored) {
    const used = perSource.get(entry.item.source_id) ?? 0;
    if (used >= sourceCap(sourceById.get(entry.item.source_id))) {
      report.dropped.source_cap++;
      continue;
    }
    perSource.set(entry.item.source_id, used + 1);
    withinSourceCaps.push(entry);
  }

  const kept = withinSourceCaps.slice(0, cap);
  report.dropped.cap = withinSourceCaps.length - kept.length;
  report.kept = kept.length;
  return { items: kept.map((entry) => entry.item), report };
}
