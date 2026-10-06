import type { Item, SeenFile, Source } from "@dispatch/core";
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

/** Larger is better. Originals beat newsletter links, then source signal, then HN and Lobsters votes. */
function quality(item: Item, sources: ReadonlyMap<string, Source>): number[] {
  const source = sources.get(item.source_id);
  return [
    isNewsletterLink(source) ? 0 : 1,
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

/** The kept item, enriched with what the dropped duplicate knew: votes, author, snippet. */
function absorb(keep: Item, dropped: Item): Item {
  const hnPoints = maxOf(keep.signals.hn_points, dropped.signals.hn_points);
  const hnComments = maxOf(keep.signals.hn_comments, dropped.signals.hn_comments);
  const lobsters = maxOf(keep.signals.lobsters_score, dropped.signals.lobsters_score);
  const author = keep.author ?? dropped.author;
  const published = keep.published_at ?? dropped.published_at;
  const content = keep.content ?? dropped.content;
  return {
    ...keep,
    ...(author ? { author } : {}),
    ...(published ? { published_at: published } : {}),
    snippet: keep.snippet !== "" ? keep.snippet : dropped.snippet,
    signals: {
      ...(hnPoints === undefined ? {} : { hn_points: hnPoints }),
      ...(hnComments === undefined ? {} : { hn_comments: hnComments }),
      ...(lobsters === undefined ? {} : { lobsters_score: lobsters }),
    },
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
 * canonical URL, newsletter links that point at an original already in the pool, then titles that
 * are near duplicates across different sources. The survivor of each pass is the higher-signal
 * item and it inherits the duplicates' votes. The result is sorted newest first, ties by id.
 */
export function dedupe({ items, sources, seen }: DedupeInput): DedupeResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const report: DedupeReport = {
    input: items.length,
    already_seen: 0,
    same_url: 0,
    newsletter_collapsed: 0,
    near_duplicate: 0,
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
  for (const item of [...fresh].sort((a, b) => compareQuality(a, b, sourceById))) {
    const existing = byUrl.get(item.canonical_url);
    if (existing) {
      byUrl.set(item.canonical_url, absorb(existing, item));
      report.same_url++;
    } else {
      byUrl.set(item.canonical_url, item);
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
    absorbed.set(match.id, absorb(absorbed.get(match.id) ?? match, item));
    report.newsletter_collapsed++;
  }
  const merged = afterNewsletters.map((item) => absorbed.get(item.id) ?? item);

  // 4. Near-duplicate titles across different sources. Best item first so it is the one kept.
  const ranked = [...merged].sort((a, b) => compareQuality(a, b, sourceById));
  const kept: { item: Item; tokens: Set<string> }[] = [];
  for (const item of ranked) {
    const tokens = titleTokens(item.title);
    const eligible = tokens.size >= MIN_TOKENS;
    const twin = eligible
      ? kept.find(
          (entry) =>
            entry.item.source_id !== item.source_id &&
            entry.tokens.size >= MIN_TOKENS &&
            jaccard(tokens, entry.tokens) >= NEAR_DUPLICATE_THRESHOLD,
        )
      : undefined;
    if (twin) {
      twin.item = absorb(twin.item, item);
      report.near_duplicate++;
    } else {
      kept.push({ item, tokens });
    }
  }

  const output = kept.map((entry) => entry.item).sort(byRecency);
  report.output = output.length;
  return { items: output, report };
}
