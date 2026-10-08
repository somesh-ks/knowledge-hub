import type {
  Item,
  Source,
  SourceCandidate,
  SourceCandidatesFile,
  Topic,
  TopicJudgmentEntry,
} from "@dispatch/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { parseFeed } from "../fetch/feedParser.js";
import { createLimiter } from "../fetch/limiter.js";
import type { HttpClient } from "../http.js";
import { buildItems } from "../normalize/buildItem.js";
import { parseFeedDate } from "../normalize/parseDate.js";
import { clamp01, round4 } from "../score/numbers.js";
import { fitCurve } from "../score/scoreTopics.js";
import { DEFAULT_SCORE_THRESHOLD } from "../score/selectItems.js";
import { hostLabel, sourceIdFor } from "./addSource.js";
import { discoverFeed } from "./discover.js";
import { urlKey } from "./import.js";

/** Weights of the quality score. They sum to 1, so q stays between 0 and 1. */
export const QUALITY_WEIGHTS = {
  fit: 0.35,
  pass_rate: 0.25,
  freshness: 0.15,
  reliability: 0.15,
  prior: 0.1,
} as const;

/** A candidate needs at least this q to be suggested, and at most this many are suggested per run. */
export const MIN_QUALITY = 0.6;
export const MAX_SUGGESTED = 6;

/** A feed must show a life of its own: this many entries, at least one in the last 30 days. */
export const MIN_ENTRIES = 5;
export const RECENT_DAYS = 30;

const SAMPLE_ITEMS = 8;
const MAX_DOMAINS = 12;
const RESULTS_PER_QUERY = 10;
const DISCOVERY_CONCURRENCY = 3;
const DAY_MS = 86_400_000;

/** Sites that are never worth a feed of their own for a topic: social networks and aggregators. */
const SKIPPED_HOSTS: readonly string[] = [
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "youtube.com",
  "youtu.be",
  "github.com",
  "news.ycombinator.com",
  "wikipedia.org",
  "tiktok.com",
  "pinterest.com",
];

export interface SuggestDeps {
  http: HttpClient;
  /** URLs of the top results for one search query. The real one calls Exa; tests pass a fake. */
  search: (query: string) => Promise<string[]>;
  /** Judges feed items against the topic. The real one is the Jev topic judge. */
  judge: {
    readonly model: string;
    judge(
      requests: readonly { item: Item; topics: readonly Topic[] }[],
    ): Promise<TopicJudgmentEntry[]>;
  };
  now: () => Date;
  log?: Logger;
}

export interface SuggestInput {
  topic: Topic;
  /** The merged registry, so a page already followed is not suggested again. */
  existing: readonly Pick<Source, "id" | "url" | "feed_url">[];
}

export interface SuggestResult {
  queries: string[];
  /** Every site looked at, with its score and status. Nothing here is added to the registry. */
  candidates: SourceCandidate[];
}

/** Three searches from the topic's name, its description, and its keywords. */
export function suggestionQueries(
  topic: Pick<Topic, "name" | "description" | "keywords">,
): string[] {
  const lead = [topic.name, ...topic.keywords.slice(0, 3)].join(" ").trim();
  const description = topic.description.slice(0, 240);
  const kinds =
    topic.keywords.length > 0
      ? `blog or newsletter about ${topic.name}: ${topic.keywords.slice(0, 5).join(", ")}`
      : `blog or newsletter about ${topic.name}`;
  return [lead, description, kinds];
}

const ExaSearchResponse = z.object({ results: z.array(z.object({ url: z.string() }).loose()) });

/** The real search: Exa, ten results per query, links only. About a cent for the three queries. */
export function createExaSearch(
  http: HttpClient,
  apiKey: string,
  baseUrl = "https://api.exa.ai",
): SuggestDeps["search"] {
  return async (query) => {
    const payload = await http.postJson(
      `${baseUrl.replace(/\/+$/, "")}/search`,
      { query, type: "auto", numResults: RESULTS_PER_QUERY },
      { headers: { "x-api-key": apiKey } },
    );
    const parsed = ExaSearchResponse.safeParse(payload);
    if (!parsed.success) throw new Error("unexpected Exa response shape");
    return parsed.data.results.map((result) => result.url);
  };
}

interface DomainHit {
  /** Site root, scheme and host. */
  origin: string;
  host: string;
  /** How many of the three queries returned it. */
  queriesHit: number;
}

function isSkipped(host: string): boolean {
  return SKIPPED_HOSTS.some((skipped) => host === skipped || host.endsWith(`.${skipped}`));
}

/** Domains the searches found, most-hit first, then in the order they appeared. */
export function collectDomains(
  resultsPerQuery: readonly (readonly string[])[],
  excludeHosts: ReadonlySet<string>,
): DomainHit[] {
  const hits = new Map<string, DomainHit & { first: number }>();
  let order = 0;
  for (const urls of resultsPerQuery) {
    const seenThisQuery = new Set<string>();
    for (const raw of urls) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (isSkipped(host) || excludeHosts.has(host) || seenThisQuery.has(host)) continue;
      seenThisQuery.add(host);
      const known = hits.get(host);
      if (known) known.queriesHit += 1;
      else hits.set(host, { origin: url.origin, host, queriesHit: 1, first: order++ });
    }
  }
  return [...hits.values()]
    .sort((a, b) => b.queriesHit - a.queriesHit || a.first - b.first)
    .slice(0, MAX_DOMAINS)
    .map(({ origin, host, queriesHit }) => ({ origin, host, queriesHit }));
}

interface FeedStats {
  entries: number;
  recentEntries: number;
  newestAgeDays: number;
  /** Share of entries with a title, a link and a date. */
  wellFormed: number;
  items: Item[];
}

/** Download and parse a feed, then summarize what a reader would get from it. */
async function inspectFeed(
  feedUrl: string,
  source: Source,
  deps: SuggestDeps,
): Promise<FeedStats | { rejected: string }> {
  let parsed: ReturnType<typeof parseFeed>;
  try {
    const response = await deps.http.fetchText(feedUrl, {
      retries: 0,
      timeoutMs: 10_000,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5",
      },
    });
    parsed = parseFeed(response.text, response.url);
  } catch (error) {
    return {
      rejected: `the feed could not be read (${error instanceof Error ? error.message : "error"})`,
    };
  }
  const now = deps.now();
  const dated = parsed.entries
    .map((entry) => ({ entry, date: parseFeedDate(entry.published ?? entry.updated) }))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  if (parsed.entries.length < MIN_ENTRIES) {
    return {
      rejected: `only ${parsed.entries.length} entries; at least ${MIN_ENTRIES} are needed`,
    };
  }
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const recent = dated.filter(({ date }) => date !== undefined && date.getTime() >= cutoff);
  if (recent.length === 0) return { rejected: `nothing published in the last ${RECENT_DAYS} days` };

  const newest = dated[0]?.date as Date;
  const wellFormed =
    parsed.entries.filter((e) => e.title && e.link && parseFeedDate(e.published ?? e.updated))
      .length / parsed.entries.length;
  // Items for the judge go through the same cleaning the fetch stage applies. The window is wide
  // on purpose: the cutoff above already decided the feed is alive.
  const sample = buildItems(
    recent.slice(0, SAMPLE_ITEMS).map(({ entry }) => ({
      url: entry.link,
      title: entry.title,
      author: entry.author,
      publishedAt: entry.published ?? entry.updated,
      summary: entry.summary ?? entry.mediaDescription,
      content: entry.content,
    })),
    {
      source,
      window: { from: new Date(now.getTime() - 400 * DAY_MS), to: now },
      fetchedAt: now,
    },
  );
  return {
    entries: parsed.entries.length,
    recentEntries: recent.length,
    newestAgeDays: Math.max(0, (now.getTime() - newest.getTime()) / DAY_MS),
    wellFormed,
    items: sample,
  };
}

/** 1 for a feed that posted this week, falling to 0 at 30 days, blended with how often it posts. */
export function freshnessOf(newestAgeDays: number, recentEntries: number): number {
  const recency = clamp01(1 - (newestAgeDays - 7) / (RECENT_DAYS - 7));
  return round4(0.6 * recency + 0.4 * Math.min(1, recentEntries / 4));
}

/**
 * The share of sampled items that would clear the score bar on fit alone: weight times the fit
 * curve against the same threshold the digest uses. A new source has no history of its own, so
 * this is the best available stand-in for how often it will pass.
 */
export function passRateOf(fits: readonly number[], weight: number): number {
  if (fits.length === 0) return 0;
  const passing = fits.filter((fit) => weight * fitCurve(fit) >= DEFAULT_SCORE_THRESHOLD).length;
  return round4(passing / fits.length);
}

/** More queries returning the domain means more agreement that it is on topic; a link roundup counts for less. */
export function priorOf(queriesHit: number, roundup: boolean): number {
  return round4(clamp01(0.4 + 0.2 * (queriesHit - 1) - (roundup ? 0.2 : 0)));
}

export function qualityOf(parts: NonNullable<SourceCandidate["parts"]>): number {
  return round4(
    clamp01(
      QUALITY_WEIGHTS.fit * parts.fit +
        QUALITY_WEIGHTS.pass_rate * parts.pass_rate +
        QUALITY_WEIGHTS.freshness * parts.freshness +
        QUALITY_WEIGHTS.reliability * parts.reliability +
        QUALITY_WEIGHTS.prior * parts.prior,
    ),
  );
}

/**
 * Find feeds for a custom topic, and only suggest them (D40). Three Exa searches give domains;
 * each domain's feed is found with the same discovery the registry uses, then validated by
 * downloading and parsing it. A survivor is scored on fit (the topic judge's mean answer over up
 * to eight recent items), the estimated pass rate, freshness, feed reliability and a prior from
 * how many searches returned it. The best six at 0.6 or better are marked "suggested". Nothing is
 * added to the registry: the owner adds the ones they want from the Sources page. Every
 * candidate comes back with its score and parts so the app can show the reasoning.
 */
export async function suggestForTopic(
  input: SuggestInput,
  deps: SuggestDeps,
): Promise<SuggestResult> {
  const { topic } = input;
  const queries = suggestionQueries(topic);
  const settled = await Promise.allSettled(queries.map((query) => deps.search(query)));
  const results = settled.map((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
  if (settled.every((outcome) => outcome.status === "rejected")) {
    const reason = (settled[0] as PromiseRejectedResult).reason;
    throw new Error(
      `every search failed: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }

  const followed = new Set(input.existing.map((source) => hostLabel(source.url)));
  const domains = collectDomains(results, followed);
  const limiter = createLimiter(DISCOVERY_CONCURRENCY);
  const taken = new Set(input.existing.map((source) => source.id));

  interface Scored {
    candidate: SourceCandidate;
  }
  const scored: Scored[] = await Promise.all(
    domains.map((domain) =>
      limiter.run(async (): Promise<Scored> => {
        const base = {
          id: sourceIdFor(domain.origin, taken),
          name: domain.host,
          url: `${domain.origin}/`,
          feed_url: null,
          q: null,
          parts: null,
          entries: 0,
          recent_entries: 0,
        } satisfies Omit<SourceCandidate, "status">;
        const reject = (reason: string, feedUrl: string | null = null): Scored => ({
          candidate: { ...base, feed_url: feedUrl, status: "rejected", reason },
        });
        try {
          const found = await discoverFeed(`${domain.origin}/`, { http: deps.http });
          if (found.status !== "feed") return reject("no feed found");
          const stub: Source = {
            id: base.id,
            name: domain.host,
            type: "rss",
            url: base.url,
            feed_url: found.feedUrl,
            tier: "daily",
            high_signal: false,
            enabled: true,
            failures: 0,
            options: {},
          };
          const stats = await inspectFeed(found.feedUrl, stub, deps);
          if ("rejected" in stats) return reject(stats.rejected, found.feedUrl);

          const answers = await deps.judge.judge(
            stats.items.map((item) => ({ item, topics: [topic] })),
          );
          const fits = answers.filter((a) => a.topic_id === topic.id).map((a) => a.fit);
          const fit = fits.length === 0 ? 0 : fits.reduce((sum, v) => sum + v, 0) / fits.length;
          const parts = {
            fit: round4(clamp01(fit)),
            pass_rate: passRateOf(fits, topic.weight),
            freshness: freshnessOf(stats.newestAgeDays, stats.recentEntries),
            reliability: round4(
              clamp01(stats.wellFormed * (found.feedUrl.startsWith("https:") ? 1 : 0.9)),
            ),
            prior: priorOf(domain.queriesHit, found.linkKind === "newsletter-link"),
          };
          const q = qualityOf(parts);
          return {
            candidate: {
              ...base,
              feed_url: found.feedUrl,
              q,
              parts,
              entries: stats.entries,
              recent_entries: stats.recentEntries,
              status: "below_bar",
              ...(fits.length === 0 ? { reason: "the topic judge answered no items" } : {}),
            },
          };
        } catch (error) {
          deps.log?.warn("A suggested site could not be checked", {
            host: domain.host,
            reason: error instanceof Error ? error.message : String(error),
          });
          return reject(
            `could not be checked (${error instanceof Error ? error.message : "error"})`,
          );
        }
      }),
    ),
  );

  // Best first; ties go to the more frequently returned domain, which is the earlier one.
  const ranked = scored
    .filter((entry) => entry.candidate.q !== null)
    .sort((a, b) => (b.candidate.q ?? 0) - (a.candidate.q ?? 0));
  let suggested = 0;
  const knownPages = new Set(
    input.existing.flatMap((s) => [urlKey(s.url), ...(s.feed_url ? [urlKey(s.feed_url)] : [])]),
  );
  for (const entry of ranked) {
    const q = entry.candidate.q ?? 0;
    if (q < MIN_QUALITY) continue;
    if (suggested >= MAX_SUGGESTED) {
      entry.candidate.status = "not_top";
      continue;
    }
    if (
      knownPages.has(urlKey(entry.candidate.url)) ||
      (entry.candidate.feed_url && knownPages.has(urlKey(entry.candidate.feed_url)))
    ) {
      entry.candidate.status = "rejected";
      entry.candidate.reason = "already a source";
      continue;
    }
    entry.candidate.status = "suggested";
    suggested += 1;
  }
  return { queries, candidates: scored.map((entry) => entry.candidate) };
}

/**
 * Replace the topic's entry in the candidates file. Other topics' entries stay as they were. A
 * candidate an earlier run added stays listed, because the site is followed now and a later run
 * no longer looks at it.
 */
export function withCandidates(
  file: SourceCandidatesFile,
  topicId: string,
  result: SuggestResult,
  at: Date,
): SourceCandidatesFile {
  const fresh = new Set(result.candidates.map((candidate) => candidate.id));
  const kept = (file.topics[topicId]?.candidates ?? []).filter(
    (candidate) => candidate.status === "added" && !fresh.has(candidate.id),
  );
  return {
    version: 1,
    topics: {
      ...file.topics,
      [topicId]: {
        suggested_at: at.toISOString(),
        queries: result.queries,
        // Best first, rejected last, so the app can show the list as it is.
        candidates: [...result.candidates, ...kept].sort(
          (a, b) => (b.q ?? -1) - (a.q ?? -1) || a.id.localeCompare(b.id),
        ),
      },
    },
  };
}
