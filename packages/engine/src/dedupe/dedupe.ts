import type { Item, SeenFile, Source } from "@singularity/core";
import { categoryHint, isTechHinted, isTrendingHinted } from "../sources/hint.js";
import { clusterStories } from "./storyCluster.js";
import { jaccard, MIN_TOKENS, titleTokens } from "./titleTokens.js";

export const NEAR_DUPLICATE_THRESHOLD = 0.8;
/** Looser bar for a newsletter link that points at a host already represented in the pool. */
export const NEWSLETTER_MATCH_THRESHOLD = 0.5;

export interface DedupeInput {
  items: readonly Item[];
  sources: readonly Source[];
  seen: SeenFile;
}

export interface DedupeReport {
  input: number;
  already_seen: number;
  same_url: number;
  newsletter_collapsed: number;
  near_duplicate: number;
  /**
   * Items absorbed because another source reported the same story: the same launch in the
   * consumer tech beat, or the same news story among the Trending outlets.
   */
  story_clustered: number;
  output: number;
}

export interface DedupeResult {
  items: Item[];
  report: DedupeReport;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isNewsletterLink(source: Source | undefined): boolean {
  return source?.options.kind === "newsletter-link";
}

/**
 * Larger is better. Originals beat newsletter links, an outlet's own feed entry beats the copy a
 * discovery search found, then source signal, then HN and Lobsters votes. Without the second step,
 * sources of equal signal fell back to the order of their ids, which put "exa-discovery" first.
 */
function quality(item: Item, sources: ReadonlyMap<string, Source>): number[] {
  const source = sources.get(item.source_id);
  return [
    isNewsletterLink(source) ? 0 : 1,
    source?.type === "exa" ? 0 : 1,
    source?.high_signal ? 1 : 0,
    item.signals.hn_points ?? 0,
    item.signals.lobsters_score ?? 0,
  ];
}

/** Negative when `a` should be kept over `b`. Ends on ids so the choice never depends on input order. */
function compareQuality(a: Item, b: Item, sources: ReadonlyMap<string, Source>): number {
  const qa = quality(a, sources);
  const qb = quality(b, sources);
  for (let i = 0; i < qa.length; i++) {
    const diff = (qb[i] ?? 0) - (qa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.source_id.localeCompare(b.source_id) || a.id.localeCompare(b.id);
}

function maxOf(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * The kept item, enriched with what the dropped duplicate knew: votes, author, snippet, and its
 * category hint when the kept item has none. The hint of the dropped item's source counts too: a
 * tech outlet's article that survives as the copy a discovery search found still belongs to the
 * tech beat.
 */
function absorb(keep: Item, dropped: Item, sources: ReadonlyMap<string, Source>): Item {
  const hnPoints = maxOf(keep.signals.hn_points, dropped.signals.hn_points);
  const hnComments = maxOf(keep.signals.hn_comments, dropped.signals.hn_comments);
  const lobsters = maxOf(keep.signals.lobsters_score, dropped.signals.lobsters_score);
  const redditScore = maxOf(keep.signals.reddit_score, dropped.signals.reddit_score);
  const redditComments = maxOf(keep.signals.reddit_comments, dropped.signals.reddit_comments);
  const youtubeViews = maxOf(keep.signals.youtube_views, dropped.signals.youtube_views);
  const youtubeVotes = maxOf(keep.signals.youtube_votes, dropped.signals.youtube_votes);
  const coverage = maxOf(keep.signals.coverage, dropped.signals.coverage);
  const author = keep.author ?? dropped.author;
  const published = keep.published_at ?? dropped.published_at;
  const content = keep.content ?? dropped.content;
  // A story one source filed under a custom topic stays under it when another copy survives.
  const topicIds = [...new Set([...(keep.topic_ids ?? []), ...(dropped.topic_ids ?? [])])];
  // The kept item's own hint (from its source or its query) stands. Only an item with none takes
  // the dropped one's, which is then written onto the item because its source cannot supply it.
  const hint =
    categoryHint(keep, sources.get(keep.source_id)) === undefined
      ? categoryHint(dropped, sources.get(dropped.source_id))
      : keep.category_hint;
  return {
    ...keep,
    ...(author ? { author } : {}),
    ...(published ? { published_at: published } : {}),
    snippet: keep.snippet !== "" ? keep.snippet : dropped.snippet,
    signals: {
      ...(hnPoints === undefined ? {} : { hn_points: hnPoints }),
      ...(hnComments === undefined ? {} : { hn_comments: hnComments }),
      ...(lobsters === undefined ? {} : { lobsters_score: lobsters }),
      ...(redditScore === undefined ? {} : { reddit_score: redditScore }),
      ...(redditComments === undefined ? {} : { reddit_comments: redditComments }),
      ...(youtubeViews === undefined ? {} : { youtube_views: youtubeViews }),
      ...(youtubeVotes === undefined ? {} : { youtube_votes: youtubeVotes }),
      ...(coverage === undefined ? {} : { coverage }),
    },
    ...(hint ? { category_hint: hint } : {}),
    ...(topicIds.length > 0 ? { topic_ids: topicIds } : {}),
    ...(content ? { content } : {}),
  };
}

function byRecency(a: Item, b: Item): number {
  const ta = a.published_at ? Date.parse(a.published_at) : Number.NEGATIVE_INFINITY;
  const tb = b.published_at ? Date.parse(b.published_at) : Number.NEGATIVE_INFINITY;
  if (ta !== tb) return tb - ta;
  return a.id.localeCompare(b.id);
}

/**
 * Collapse the pool to one entry per story. Order of passes: items already in seen.json, same
 * canonical URL, newsletter links that point at an original already in the pool, titles that are
 * near duplicates across different sources, and last, for the consumer tech beat only, different
 * headlines about the same launch. The survivor of each pass is the higher-signal item and it
 * inherits the duplicates' votes. The result is sorted newest first, ties by id.
 */
export function dedupe({ items, sources, seen }: DedupeInput): DedupeResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const merge = (keep: Item, dropped: Item): Item => absorb(keep, dropped, sourceById);
  const report: DedupeReport = {
    input: items.length,
    already_seen: 0,
    same_url: 0,
    newsletter_collapsed: 0,
    near_duplicate: 0,
    story_clustered: 0,
    output: 0,
  };

  // 1. Already shown or judged in an earlier run.
  const fresh = items.filter((item) => {
    if (Object.hasOwn(seen.items, item.id)) {
      report.already_seen++;
      return false;
    }
    return true;
  });

  // 2. Same canonical URL.
  const byUrl = new Map<string, Item>();
  const urlKeys = new Map<string, string[]>();
  for (const item of [...fresh].sort((a, b) => compareQuality(a, b, sourceById))) {
    // Every report kept for this page (the first under the URL, the rest under URL and id).
    const keys = urlKeys.get(item.canonical_url) ?? [];
    // An exact id match wins over a title match, whatever the order of the page's reports.
    const matchKey =
      keys.find((key) => byUrl.get(key)?.id === item.id) ??
      keys.find((key) => {
        const candidate = byUrl.get(key);
        return (
          candidate !== undefined &&
          candidate.source_id !== item.source_id &&
          jaccard(titleTokens(candidate.title), titleTokens(item.title)) >= NEAR_DUPLICATE_THRESHOLD
        );
      });
    const existing = matchKey === undefined ? undefined : byUrl.get(matchKey);
    // Same URL, different ids: two stories that share a page (see buildItems). Another source's
    // item absorbs only the one it is about, never every entry of the page.
    if (existing && matchKey !== undefined) {
      byUrl.set(matchKey, merge(existing, item));
      report.same_url++;
    } else if (keys.length > 0) {
      const key = `${item.canonical_url}
${item.id}`;
      byUrl.set(key, item);
      urlKeys.set(item.canonical_url, [...keys, key]);
    } else {
      byUrl.set(item.canonical_url, item);
      urlKeys.set(item.canonical_url, [item.canonical_url]);
    }
  }
  const unique = [...byUrl.values()];

  // 3. Newsletter links that duplicate an original from the same host.
  const originals = unique.filter((item) => !isNewsletterLink(sourceById.get(item.source_id)));
  const originalsByHost = new Map<string, Item[]>();
  for (const original of originals) {
    const host = hostOf(original.canonical_url);
    originalsByHost.set(host, [...(originalsByHost.get(host) ?? []), original]);
  }
  const absorbed = new Map<string, Item>();
  const afterNewsletters: Item[] = [];
  for (const item of unique) {
    if (!isNewsletterLink(sourceById.get(item.source_id))) {
      afterNewsletters.push(item);
      continue;
    }
    const tokens = titleTokens(item.title);
    const match = (originalsByHost.get(hostOf(item.canonical_url)) ?? []).find(
      (original) =>
        pathOf(original.canonical_url) === pathOf(item.canonical_url) ||
        jaccard(tokens, titleTokens(original.title)) >= NEWSLETTER_MATCH_THRESHOLD,
    );
    if (!match) {
      afterNewsletters.push(item);
      continue;
    }
    absorbed.set(match.id, merge(absorbed.get(match.id) ?? match, item));
    report.newsletter_collapsed++;
  }
  const merged = afterNewsletters.map((item) => absorbed.get(item.id) ?? item);

  // 4. Near-duplicate titles across different sources. Best item first so it is the one kept.
  const isTech = (item: Item): boolean => isTechHinted(item, sourceById.get(item.source_id));
  const isTrending = (item: Item): boolean =>
    isTrendingHinted(item, sourceById.get(item.source_id));
  // The other sources behind a kept tech or Trending item, so a twin merged here still counts as
  // coverage. A Trending story is only ever merged with another outlet's Trending story, so a
  // general news copy never disappears into an item of another beat.

  const outlets = new Map<string, Set<string>>();
  const ranked = [...merged].sort((a, b) => compareQuality(a, b, sourceById));
  const kept: { item: Item; tokens: Set<string> }[] = [];
  for (const item of ranked) {
    const tokens = titleTokens(item.title);
    const eligible = tokens.size >= MIN_TOKENS;
    const twin = eligible
      ? kept.find(
          (entry) =>
            entry.item.source_id !== item.source_id &&
            isTrending(entry.item) === isTrending(item) &&
            entry.tokens.size >= MIN_TOKENS &&
            jaccard(tokens, entry.tokens) >= NEAR_DUPLICATE_THRESHOLD,
        )
      : undefined;
    if (twin) {
      if ((isTech(twin.item) && isTech(item)) || (isTrending(twin.item) && isTrending(item))) {
        const sources = outlets.get(twin.item.id) ?? new Set<string>();
        sources.add(item.source_id);
        outlets.set(twin.item.id, sources);
      }
      twin.item = merge(twin.item, item);
      report.near_duplicate++;
    } else {
      kept.push({ item, tokens });
    }
  }

  // 5. One launch, several outlets, different headlines. Tech-hinted items only.
  const clustered = clusterStories({
    items: kept.map((entry) => entry.item),
    eligible: isTech,
    compare: (a, b) => compareQuality(a, b, sourceById),
    absorb: merge,
    outlets,
  });
  // 6. The same news story at several outlets (D40), by the news vocabulary and a 48 hour window.
  const trending = clusterStories({
    profile: "news",
    items: clustered.items,
    eligible: isTrending,
    compare: (a, b) => compareQuality(a, b, sourceById),
    absorb: merge,
    outlets,
  });
  report.story_clustered = clustered.merged + trending.merged;

  const output = trending.items.sort(byRecency);
  report.output = output.length;
  return { items: output, report };
}
