import {
  type Item,
  NORMAL_TASTE,
  type Preferences,
  type Source,
  type SourceType,
} from "@singularity/core";
import {
  categoryHint,
  isDesignHinted,
  isTechHinted,
  isTopicTagged,
  isTrendingHinted,
} from "../sources/hint.js";
import {
  isTrustedPublisher,
  type TrustedPublisherMatcher,
} from "../trustedPublishers/trustedPublishers.js";
import { authorMatches, containsPhrase, keywordRegExp } from "./phrase.js";
import { releaseWeight } from "./releaseWeight.js";

/** The Software Engineering depth category, whose sources pass by their filing (D155). */
const DEPTH_CATEGORY = "software_engineering_depth";

export const DEFAULT_CAP = 60;
/**
 * Candidates the consumer tech beat may send to the judge, beside the main cap. The Tech releases
 * section publishes five, so twenty leaves the judge four to choose from for every slot.
 */
export const TECH_CAP = 20;
/**
 * Candidates the Trending beat may send to the judge. Only stories at least two outlets covered
 * get this far, ranked by coverage, and the section publishes five.
 */
export const TRENDING_CAP = 12;
/** A Trending story needs this many distinct outlets (D40). */
export const MIN_TRENDING_COVERAGE = 2;
/** HN points above which an item stays even with no keyword or author match. */
export const STRONG_HN_POINTS = 100;
/** The same for a Reddit score: its threads run higher in the subreddits we read (D240). */
export const STRONG_REDDIT_SCORE = 200;

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
  /** Cap for everything outside the consumer tech beat. */
  cap?: number;
  /** Cap for the consumer tech beat. */
  techCap?: number;
  /** Cap for the Trending beat. */
  trendingCap?: number;
  /** The owner's vetted publishers (D234): their pages count as high signal, as a favourite source's do. */
  trustedPublishers?: TrustedPublisherMatcher;
}

export interface PrefilterReport {
  input: number;
  /** Kept in both pools together. */
  kept: number;
  /** Totals over both pools, so `input` equals `kept` plus the four counts. */
  dropped: {
    /** Matched a disliked pattern. */
    disliked: number;
    /** No keyword, author, high-signal source or strong signal, and not from the tech beat. */
    not_relevant: number;
    /** Over the per-source limit. */
    source_cap: number;
    /** Relevant, but below the cap of its pool. */
    cap: number;
  };
  /** The consumer tech sub-pool on its own: what entered it, what stayed, and what each cap cut. */
  tech: {
    input: number;
    kept: number;
    source_cap: number;
    cap: number;
  };
  /** The Trending sub-pool: what entered it, what only one outlet carried, what stayed. */
  trending: {
    input: number;
    single_outlet: number;
    kept: number;
    source_cap: number;
    cap: number;
  };
}

export interface PrefilterResult {
  /** Best first inside each pool: the main pool, then the tech pool. */
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

function recencyOf(item: Item, now: Date): number {
  const ageDays = item.published_at
    ? (now.getTime() - Date.parse(item.published_at)) / DAY_MS
    : RECENCY_DAYS;
  return Math.max(0, 1 - Math.max(0, ageDays) / RECENCY_DAYS);
}

const byScoreThenId = (a: Scored, b: Scored): number =>
  b.score - a.score || a.item.id.localeCompare(b.item.id);

/** Best first, with at most each source's limit, cut to `cap`. Counts what each limit removed. */
function rankAndCap(
  scored: Scored[],
  cap: number,
  sourceById: ReadonlyMap<string, Source>,
): { kept: Item[]; overSource: number; overCap: number } {
  scored.sort(byScoreThenId);
  const perSource = new Map<string, number>();
  const withinSourceCaps: Scored[] = [];
  let overSource = 0;
  for (const entry of scored) {
    const used = perSource.get(entry.item.source_id) ?? 0;
    if (used >= sourceCap(sourceById.get(entry.item.source_id))) {
      overSource++;
      continue;
    }
    perSource.set(entry.item.source_id, used + 1);
    withinSourceCaps.push(entry);
  }
  const kept = withinSourceCaps.slice(0, Math.max(0, cap));
  return {
    kept: kept.map((entry) => entry.item),
    overSource,
    overCap: withinSourceCaps.length - kept.length,
  };
}

/**
 * Cheap, deterministic triage before any model is involved. Hard-drops disliked patterns, then
 * works two pools side by side.
 *
 * The main pool keeps what matches a preferred keyword or author, comes from a high-signal source
 * or carries strong votes, ranks it and caps it at 60.
 *
 * The tech pool takes every item from the consumer tech beat (a source or discovery query hinted
 * `consumer_tech_releases`): launch news matches none of the craft keywords, so the hint itself is
 * the relevance test. It is ranked by `2 x log2(1 + coverage) + recency`, where coverage is the
 * number of sources that reported the story (1 when story clustering merged nothing into it), and
 * capped at 20. Two sources score at least 3.17 and one source at most 3, so a story more than
 * one outlet covered always outranks a single-source story, however fresh, and no model is asked
 * which launches are big.
 *
 * The same inputs always give the same output, in the same order.
 */
export function prefilter({
  items,
  preferences,
  sources,
  now,
  cap = DEFAULT_CAP,
  techCap = TECH_CAP,
  trendingCap = TRENDING_CAP,
  trustedPublishers,
}: PrefilterInput): PrefilterResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const keywords = preferences.preferred_keywords.map((keyword) => keywordRegExp(keyword));
  const report: PrefilterReport = {
    input: items.length,
    kept: 0,
    dropped: { disliked: 0, not_relevant: 0, source_cap: 0, cap: 0 },
    tech: { input: 0, kept: 0, source_cap: 0, cap: 0 },
    trending: { input: 0, single_outlet: 0, kept: 0, source_cap: 0, cap: 0 },
  };

  const main: Scored[] = [];
  const tech: Scored[] = [];
  const trending: Scored[] = [];
  for (const item of items) {
    const text = `${item.title} ${item.snippet}`;
    if (preferences.disliked_patterns.some((pattern) => containsPhrase(text, pattern))) {
      report.dropped.disliked++;
      continue;
    }

    const source = sourceById.get(item.source_id);
    const recency = recencyOf(item, now);
    // General news outlets feed Trending and nothing else (D40). Only a story several outlets
    // carried goes on, ranked by how many; a story one outlet carried never qualifies.
    if (isTrendingHinted(item, source)) {
      report.trending.input++;
      const coverage = item.signals.coverage ?? 1;
      if (coverage < MIN_TRENDING_COVERAGE) {
        report.trending.single_outlet++;
        report.dropped.not_relevant++;
        continue;
      }
      trending.push({ item, score: 2 * Math.log2(1 + coverage) + recency });
      continue;
    }
    if (isTechHinted(item, source)) {
      const coverage = Math.max(1, item.signals.coverage ?? 1);
      tech.push({ item, score: 2 * Math.log2(1 + coverage) + recency });
      continue;
    }

    const titleHits = keywords.filter((re) => re.test(item.title)).length;
    const snippetHits = keywords.filter(
      (re) => !re.test(item.title) && re.test(item.snippet),
    ).length;
    const authorHit = preferences.preferred_authors.some((name) =>
      authorMatches(item.author, name),
    );
    const highSignal = source?.high_signal === true || isTrustedPublisher(trustedPublishers, item);
    const hnPoints = item.signals.hn_points ?? 0;
    const redditScore = item.signals.reddit_score ?? 0;
    const strong = hnPoints > STRONG_HN_POINTS || redditScore > STRONG_REDDIT_SCORE;

    // A source shipped for Design is relevant by being tagged, as the tech beat is by its hint, and
    // an engineering blog filed for Software Engineering by its hint or tag (D155), unless that
    // category is Off: their posts rarely name a design keyword.
    const designTagged = isDesignHinted(item, source);
    const hint = categoryHint(item, source);
    const depthHinted = hint === DEPTH_CATEGORY || isTopicTagged(item, source, DEPTH_CATEGORY);
    if (
      titleHits + snippetHits === 0 &&
      !authorHit &&
      !highSignal &&
      !strong &&
      !designTagged &&
      !depthHinted
    ) {
      report.dropped.not_relevant++;
      continue;
    }

    const categoryWeight = hint ? NORMAL_TASTE : 0.5;
    const votes =
      Math.min(3, Math.log10(1 + hnPoints)) +
      Math.min(2, Math.log10(1 + Math.max(0, item.signals.lobsters_score ?? 0))) +
      Math.min(2, Math.log10(1 + Math.max(0, redditScore)));
    const score =
      3 * titleHits +
      snippetHits +
      (authorHit ? 4 : 0) +
      (highSignal ? 3 : 0) +
      votes +
      2 * categoryWeight +
      recency +
      releaseWeight(item);
    main.push({ item, score });
  }

  report.tech.input = tech.length;
  const mainPool = rankAndCap(main, cap, sourceById);
  const techPool = rankAndCap(tech, techCap, sourceById);
  const trendingPool = rankAndCap(trending, trendingCap, sourceById);
  report.trending.kept = trendingPool.kept.length;
  report.trending.source_cap = trendingPool.overSource;
  report.trending.cap = trendingPool.overCap;
  report.tech.kept = techPool.kept.length;
  report.tech.source_cap = techPool.overSource;
  report.tech.cap = techPool.overCap;
  report.dropped.source_cap = mainPool.overSource + techPool.overSource + trendingPool.overSource;
  report.dropped.cap = mainPool.overCap + techPool.overCap + trendingPool.overCap;
  report.kept = mainPool.kept.length + techPool.kept.length + trendingPool.kept.length;
  return { items: [...mainPool.kept, ...techPool.kept, ...trendingPool.kept], report };
}
