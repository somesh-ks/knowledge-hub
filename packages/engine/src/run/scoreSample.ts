import {
  daysBetween,
  feedsGeneralOnly,
  Item,
  JudgmentEntry,
  type JudgmentsFile,
  MIN_JUDGED,
  type Preferences,
  type SeenFile,
  type Source,
  type SourceStatsFile,
  type SourceType,
} from "@dispatch/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { FETCHERS } from "../fetch/fetchers.js";
import type { SourceFetcher, SourceResult } from "../fetch/types.js";
import type { HttpClient } from "../http.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { scoreItem } from "../score/scoreItem.js";
import { eligibility } from "../score/selectItems.js";
import type { SourceCounts } from "../state/sourceStats.js";
import { isFlagged } from "./sourceCounts.js";

/**
 * The scoring sample (D70). A source's score learns only from items a judge answered, and the
 * prefilter sends the judge about 80 of the 1,200 or so items a run fetches, so most sources never
 * reach the ten judged items a score needs. Each regular pass therefore judges a few more items for
 * the score alone: never in the pool, never published, never marked seen.
 *
 * - A source under the bar gets up to SAMPLE_PER_SOURCE of the run's left-over items (fetched in
 *   the window, dropped by the prefilter).
 * - A source under the bar with a feed reads that feed itself at most once every REFILL_DAYS: the
 *   first time BACKFILL_DAYS back, which gives a new source a score after its first run, later
 *   REFILL_DAYS back. It takes as many items as it lacks.
 * - A switched-off source with a feed is read once every PROBE_DAYS and gives PROBE_PER_SOURCE
 *   items, so its score says whether it has earned a place. A switched-off general news feed is
 *   read with the pass's general feeds instead and judged like them (judgeGeneral).
 *
 * The run's sample stops at SAMPLE_CEILING items and FEED_READ_CEILING feed reads; the sources
 * with the fewest judged items go first, so the cost of a run stays bounded and the sources
 * furthest from a score are served first. An item a judge already answered (in the judgment cache
 * or in seen.json) or that is in this run's pool is never sampled, so nothing counts twice.
 */
export const SAMPLE_CEILING = 200;
/** Most left-over items one source gets in a run. */
export const SAMPLE_PER_SOURCE = 4;
/** Most items a switched-off source gives in a weekly check. */
export const PROBE_PER_SOURCE = 4;
/** Most feeds the sample reads in one run, besides the pass's own fetch. */
export const FEED_READ_CEILING = 40;
/** A source under the bar reads its own feed at most once in this many days. */
export const REFILL_DAYS = 30;
/** How far back a source's first feed read looks. */
export const BACKFILL_DAYS = 90;
/** A switched-off source is checked once in this many days. */
export const PROBE_DAYS = 7;
/**
 * A switched-on source failing this many fetches in a row is not refilled: its own fetch is
 * failing too, its health part says so, and a dead feed would take a read every run.
 */
export const REFILL_MAX_FAILURES = 2;

const DAY_MS = 86_400_000;
const READ_CONCURRENCY = 6;
const READ_TIMEOUT_MS = 15_000;

/** Source types whose items the sample can read from the source's own feed. */
const READABLE: ReadonlySet<SourceType> = new Set<SourceType>(["rss", "github"]);

/** `.cache/run/<id>/sample.json`: what one pass judges for the score alone. */
export const SampleFile = z.object({
  version: z.literal(1),
  items: z.array(Item),
  /** Sources whose own feed the sample read this pass, whatever came of it. */
  reads: z.array(z.string()),
  /** Posts each read feed held in its look-back: under ten, the source posts rarely. */
  feed_posts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Switched-off general feeds the pass tried for their check, with the stories each gave. */
  general_reads: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type SampleFile = z.infer<typeof SampleFile>;

/** `.cache/run/<id>/sample-judged.json`: the judge's answers for the sample. */
export const SampleJudgedFile = z.object({
  version: z.literal(1),
  entries: z.array(JudgmentEntry),
  unjudged: z.array(z.string()),
});
export type SampleJudgedFile = z.infer<typeof SampleJudgedFile>;

export type ReadReason = "refill" | "probe";

export interface FeedRead {
  source: Source;
  reason: ReadReason;
  /** The oldest post the read keeps. */
  from: Date;
}

export interface ReadPlan {
  /** Feeds the sample reads itself, fewest judged first, at most FEED_READ_CEILING. */
  reads: FeedRead[];
  /** Switched-off general news feeds due a check, read with the pass's general feeds. */
  probeGeneral: Source[];
}

type Stats = SourceStatsFile["sources"];

const judgedOf = (stats: Stats, id: string): number => stats[id]?.judged ?? 0;

function due(stats: Stats, id: string, today: string, days: number): boolean {
  const at = stats[id]?.sampled_at;
  return at === undefined || daysBetween(at, today) >= days;
}

function readable(source: Source): boolean {
  if (!READABLE.has(source.type)) return false;
  return source.type === "github"
    ? Boolean(source.feed_url ?? source.options.repo)
    : source.feed_url !== null;
}

/**
 * Which feeds the sample reads this run. Pure. A source under the bar reads its own feed when it
 * has not for REFILL_DAYS; a switched-off one when it has not for PROBE_DAYS.
 */
export function planReads(input: {
  sources: readonly Source[];
  stats: SourceStatsFile;
  today: string;
  now: Date;
  readCeiling?: number;
}): ReadPlan {
  const { stats, today, now } = input;
  const s = stats.sources;
  const reads: FeedRead[] = [];
  const probeGeneral: Source[] = [];
  for (const source of input.sources) {
    const general = feedsGeneralOnly(source.topic_ids);
    if (!source.enabled) {
      if (!due(s, source.id, today, PROBE_DAYS)) continue;
      if (general) {
        if (source.type === "rss" && source.feed_url !== null) probeGeneral.push(source);
      } else if (readable(source)) {
        reads.push({
          source,
          reason: "probe",
          from: new Date(now.getTime() - REFILL_DAYS * DAY_MS),
        });
      }
      continue;
    }
    // A general feed has every story judged already (D66); the rest wait until they need more.
    if (general || !readable(source) || judgedOf(s, source.id) >= MIN_JUDGED) continue;
    if (source.failures >= REFILL_MAX_FAILURES) continue;
    if (!due(s, source.id, today, REFILL_DAYS)) continue;
    const back = s[source.id]?.sampled_at === undefined ? BACKFILL_DAYS : REFILL_DAYS;
    reads.push({ source, reason: "refill", from: new Date(now.getTime() - back * DAY_MS) });
  }
  reads.sort(
    (a, b) =>
      judgedOf(s, a.source.id) - judgedOf(s, b.source.id) || a.source.id.localeCompare(b.source.id),
  );
  return { reads: reads.slice(0, input.readCeiling ?? FEED_READ_CEILING), probeGeneral };
}

/**
 * Read the planned feeds. A read that fails yields nothing and its result says why; a switched-off
 * source's result feeds its health, since nothing else fetches it.
 */
export async function readFeeds(
  reads: readonly FeedRead[],
  deps: {
    http: HttpClient;
    now: Date;
    fetchers?: Partial<Record<SourceType, SourceFetcher>> | undefined;
  },
): Promise<{ items: Map<string, Item[]>; results: SourceResult[] }> {
  const items = new Map<string, Item[]>();
  const results = await mapConcurrent(reads, READ_CONCURRENCY, async (read) => {
    const started = Date.now();
    const fetcher = deps.fetchers?.[read.source.type] ?? FETCHERS[read.source.type];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The signal stops a well-behaved fetcher; the race stops one that ignores it.
      const got = await Promise.race([
        fetcher(
          read.source,
          { from: read.from, to: deps.now },
          { http: deps.http, now: () => deps.now, signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${READ_TIMEOUT_MS} ms`)),
            READ_TIMEOUT_MS + 1_000,
          );
        }),
      ]);
      items.set(read.source.id, got);
      return { source_id: read.source.id, ok: true, count: got.length, ms: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        source_id: read.source.id,
        ok: false,
        count: 0,
        ms: Date.now() - started,
        error: message.replace(/\s+/g, " ").slice(0, 200),
      };
    } finally {
      clearTimeout(timer);
    }
  });
  return { items, results };
}

function newestFirst(a: Item, b: Item): number {
  const at = (item: Item): number => Date.parse(item.published_at ?? item.fetched_at) || 0;
  return at(b) - at(a) || a.id.localeCompare(b.id);
}

/**
 * The items to judge for the score alone. Pure. Every source under the bar, and every source whose
 * feed was read, is served in order of fewest judged items, until the ceiling.
 */
export function pickSample(input: {
  sources: readonly Source[];
  stats: SourceStatsFile;
  leftovers: readonly Item[];
  reads: readonly FeedRead[];
  read: ReadonlyMap<string, readonly Item[]>;
  /** True for an item a judge already answered, or one this run's pool holds. */
  known: (itemId: string) => boolean;
  ceiling?: number;
}): Item[] {
  const s = input.stats.sources;
  const reasons = new Map(input.reads.map((read) => [read.source.id, read.reason]));
  const leftovers = new Map<string, Item[]>();
  for (const item of input.leftovers) {
    const list = leftovers.get(item.source_id) ?? [];
    list.push(item);
    leftovers.set(item.source_id, list);
  }
  const quota = (source: Source): number => {
    const reason = reasons.get(source.id);
    if (reason === "probe") return PROBE_PER_SOURCE;
    if (!source.enabled || feedsGeneralOnly(source.topic_ids)) return 0;
    const need = Math.max(0, MIN_JUDGED - judgedOf(s, source.id));
    return reason === "refill" ? need : Math.min(need, SAMPLE_PER_SOURCE);
  };
  const order = [...input.sources]
    .filter((source) => quota(source) > 0)
    .sort((a, b) => judgedOf(s, a.id) - judgedOf(s, b.id) || a.id.localeCompare(b.id));

  const ceiling = input.ceiling ?? SAMPLE_CEILING;
  const taken = new Set<string>();
  const picked: Item[] = [];
  for (const source of order) {
    const room = Math.min(quota(source), ceiling - picked.length);
    if (room <= 0) break;
    // A feed read and the left-overs can hold the same post: one copy, newest first.
    const candidates = new Map<string, Item>();
    for (const item of [
      ...(input.read.get(source.id) ?? []),
      ...(leftovers.get(source.id) ?? []),
    ]) {
      if (!taken.has(item.id) && !input.known(item.id)) candidates.set(item.id, item);
    }
    for (const item of [...candidates.values()].sort(newestFirst).slice(0, room)) {
      taken.add(item.id);
      picked.push(item);
    }
  }
  return picked;
}

/**
 * True for an item a judge already answered, by any model: in the judgment cache, or seen in a
 * briefing pool. The fetch stage has no judge yet, so the model does not narrow it; an item judged
 * under older questions is left alone too, which is the safe side for counting.
 */
export function answeredBefore(cache: JudgmentsFile, seen: SeenFile): (itemId: string) => boolean {
  const judged = new Set(Object.values(cache.entries).map((entry) => entry.item_id));
  return (itemId) => seen.items[itemId] !== undefined || judged.has(itemId);
}

/**
 * Per-source counters of a judged sample, to add to the pass's counters. A sampled item counts as
 * judged and as sampled, passed when it would have been eligible to publish on its built-in
 * categories, and asked (and flagged) like any item the judge asked the flag questions.
 *
 * A read counts as done (`read_feed`, which moves `sampled_at`, with the feed's post count) when
 * the judge answered every item it offered, or it offered none. One with an item the judge could
 * not answer (an outage) is read again on a later run, where the answered items are known and only
 * the rest are offered; every read is, when the sample was not judged at all. A switched-off
 * general feed's check is done once tried: its stories are judged apart, as the ceiling allows.
 */
export function countSample(input: {
  sample: SampleFile;
  judged: SampleJudgedFile | null;
  preferences: Preferences;
  /** The pass's general counts (countGeneral), for the general feeds' checks. */
}): Record<string, SourceCounts> {
  const out: Record<string, SourceCounts> = {};
  const row = (id: string): SourceCounts => {
    out[id] ??= { fetched: 0, judged: 0, passed: 0, asked: 0, flagged: 0, sampled: 0 };
    return out[id];
  };
  for (const id of Object.keys(input.sample.general_reads)) row(id).read_feed = true;
  if (input.judged === null) return out;
  const items = new Map(input.sample.items.map((item) => [item.id, item]));
  for (const entry of input.judged.entries) {
    const item = items.get(entry.item_id);
    if (!item) continue;
    const counts = row(item.source_id);
    counts.judged += 1;
    counts.sampled = (counts.sampled ?? 0) + 1;
    counts.asked = (counts.asked ?? 0) + 1;
    if (isFlagged(entry.flags)) counts.flagged = (counts.flagged ?? 0) + 1;
    if (eligibility(scoreItem(entry, input.preferences, item)).eligible) counts.passed += 1;
  }
  const unanswered = new Set(input.judged.unjudged);
  const waiting = new Set(
    input.sample.items.filter((item) => unanswered.has(item.id)).map((item) => item.source_id),
  );
  for (const id of input.sample.reads) {
    if (waiting.has(id)) continue;
    row(id).read_feed = true;
    const posts = input.sample.feed_posts[id];
    if (posts !== undefined) row(id).feed_posts = posts;
  }
  return out;
}

/** Add the sample's counters to a pass's counters. */
export function mergeSampleCounts(
  base: Readonly<Record<string, SourceCounts>>,
  sample: Readonly<Record<string, SourceCounts>>,
): Record<string, SourceCounts> {
  const out: Record<string, SourceCounts> = { ...base };
  for (const [id, add] of Object.entries(sample)) {
    const before = out[id] ?? { fetched: 0, judged: 0, passed: 0 };
    out[id] = {
      ...before,
      judged: before.judged + add.judged,
      passed: before.passed + add.passed,
      asked: (before.asked ?? 0) + (add.asked ?? 0),
      flagged: (before.flagged ?? 0) + (add.flagged ?? 0),
      sampled: (before.sampled ?? 0) + (add.sampled ?? 0),
      ...(add.read_feed || before.read_feed ? { read_feed: true } : {}),
      ...(add.feed_posts === undefined ? {} : { feed_posts: add.feed_posts }),
    };
  }
  return out;
}

/** A pass's sample files, or nulls when it has none or they cannot be read. */
export async function readSampleFiles(
  samplePath: string,
  judgedPath: string,
): Promise<{ sample: SampleFile | null; judged: SampleJudgedFile | null }> {
  const read = async <T>(path: string, schema: z.ZodType<T>, name: string): Promise<T | null> => {
    try {
      const parsed = schema.safeParse(await readJsonIfExists(path, name));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
  return {
    sample: await read(samplePath, SampleFile, "sample.json"),
    judged: await read(judgedPath, SampleJudgedFile, "sample-judged.json"),
  };
}
