import { generalTopics, Item, type Source, type Topic, type TopicsFile } from "@dispatch/core";
import { z } from "zod";
import { clusterStories } from "../dedupe/storyCluster.js";
import { round4 } from "../score/numbers.js";
import { fitCurve } from "../score/scoreTopics.js";
import { DEFAULT_SCORE_THRESHOLD } from "../score/selectItems.js";
import type { SourceCounts } from "../state/sourceStats.js";
import { isFlagged } from "./sourceCounts.js";

/**
 * Most general stories one pass sends to the judge (D66). The owner chose to have Jev judge every
 * story of the general feeds, so this is a safety net against a runaway feed, not a sample: a
 * normal two-day window holds a few hundred. Over it, the stories fewest outlets carried and the
 * oldest wait, and the judge stage logs it.
 */
export const GENERAL_JUDGE_CEILING = 600;

const count = z.number().int().nonnegative();

/**
 * `.cache/run/<id>/general.json`: the stories of the general news feeds for one pass, kept apart
 * from the pool so nothing in it can reach a briefing, the regular, on-demand or weekly digest.
 * Each item is one story: copies of it at other outlets are folded in (carriers lists every source
 * that carried it) and `signals.coverage` is the number of distinct outlets.
 */
export const GeneralPoolFile = z.object({
  version: z.literal(1),
  items: z.array(Item),
  /** Item id to the ids of every source that carried the story, the kept item's source first. */
  carriers: z.record(z.string(), z.array(z.string())),
  /**
   * Switched-off feeds read only for their weekly check (D70). A story none but these carried is
   * judged last, so a check never takes the place of a switched-on feed's story.
   */
  checked: z.array(z.string()).optional(),
  report: z.object({
    /** Items the general sources returned in the window. */
    fetched: count,
    /** Folded into another by canonical address: one story, two feeds. */
    same_url: count,
    /** Folded into another by the news clustering: one story, different headlines. */
    story_clustered: count,
    stories: count,
  }),
});
export type GeneralPoolFile = z.infer<typeof GeneralPoolFile>;

const fit = z.number().min(0).max(1);

/** `.cache/run/<id>/general-judged.json`: the judge's answers for the general stories of one pass. */
export const GeneralJudgedFile = z.object({
  version: z.literal(1),
  judge: z.object({ model: z.string(), questions_hash: z.string() }),
  entries: z.array(
    z.object({
      item_id: z.string(),
      /** Absent when the reply held no flag answers: judged, but not asked the trust questions. */
      flags: z.object({ hype: fit, sponsored: fit }).optional(),
      /** Topic id to fit, and the hash of the question each was asked with. */
      fits: z.record(z.string(), fit),
      hashes: z.record(z.string(), z.string()),
    }),
  ),
  /** Stories the judge could not answer. */
  unjudged: z.array(z.string()),
  counts: z.object({
    pool: count,
    /** Stories over the ceiling that were left out. */
    over_ceiling: count,
    /** Answers kept from an earlier attempt of the same pass. */
    reused: count,
    /** Jev requests this attempt made. */
    requests: count,
    judged: count,
    unjudged: count,
  }),
});
export type GeneralJudgedFile = z.infer<typeof GeneralJudgedFile>;

/**
 * The general topics that are switched on. A repository without a topics file, or one written
 * before the general topics existed, reads them as switched on, as resolveTopics restores them.
 */
export function activeGeneralFrom(file: TopicsFile | null): Topic[] {
  const own = new Map((file?.topics ?? []).map((topic) => [topic.id, topic]));
  return generalTopics()
    .map((seed) => own.get(seed.id) ?? seed)
    .filter((topic) => topic.origin === "general" && topic.enabled);
}

const WWW = /^www\./;

/**
 * The outlet behind a source: the host of its page. NPR's world and business feeds are two
 * sources of one outlet, and a story both carry has been carried once. A source whose address does
 * not parse stands for itself.
 */
export function outletOf(source: Pick<Source, "id" | "url">): string {
  try {
    return new URL(source.url).hostname.toLowerCase().replace(WWW, "");
  } catch {
    return source.id;
  }
}

function timeOf(item: Item): number {
  const ms = Date.parse(item.published_at ?? item.fetched_at);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Turn the items general sources returned into the pass's general stories. Copies of one story
 * are folded, first by address and then by the news clustering that Trending and general episodes
 * use (two or more shared names or numbers within 48 hours), counted by outlet. A story keeps the
 * topics of every copy, limited to the switched-on ones; one with none left is dropped.
 */
export function buildGeneralPool(input: {
  items: readonly Item[];
  sources: ReadonlyMap<string, Source>;
  activeTopicIds: ReadonlySet<string>;
  /** Switched-off feeds read for their weekly check (D70). */
  checked?: ReadonlySet<string>;
}): GeneralPoolFile {
  const { sources, activeTopicIds } = input;
  const real = new Map<string, Item>();
  const carriers = new Map<string, Set<string>>();
  const outlets = new Map<string, Set<string>>();
  const topics = new Map<string, Set<string>>();
  let sameUrl = 0;

  const outletFor = (item: Item): string => {
    const source = sources.get(item.source_id);
    return source ? outletOf(source) : item.source_id;
  };
  const ordered = [...input.items].sort(
    (a, b) => a.source_id.localeCompare(b.source_id) || a.id.localeCompare(b.id),
  );
  for (const item of ordered) {
    const own = (item.topic_ids ?? []).filter((id) => activeTopicIds.has(id));
    if (own.length === 0) continue;
    const known = real.get(item.id);
    if (known) {
      sameUrl += 1;
      carriers.get(item.id)?.add(item.source_id);
      outlets.get(item.id)?.add(outletFor(item));
      for (const id of own) topics.get(item.id)?.add(id);
      continue;
    }
    real.set(item.id, item);
    carriers.set(item.id, new Set([item.source_id]));
    outlets.set(item.id, new Set([outletFor(item)]));
    topics.set(item.id, new Set(own));
  }

  // The clustering counts distinct source ids, so it works on copies whose source is the outlet.
  const working = [...real.values()].map((item) => ({ ...item, source_id: outletFor(item) }));
  const clustered = clusterStories({
    profile: "news",
    items: working,
    eligible: () => true,
    // The fuller description leads, then the newest; id makes the order total.
    compare: (a, b) =>
      b.snippet.length - a.snippet.length || timeOf(b) - timeOf(a) || a.id.localeCompare(b.id),
    absorb: (keep, dropped) => {
      for (const source of carriers.get(dropped.id) ?? []) carriers.get(keep.id)?.add(source);
      for (const topic of topics.get(dropped.id) ?? []) topics.get(keep.id)?.add(topic);
      for (const outlet of outlets.get(dropped.id) ?? []) outlets.get(keep.id)?.add(outlet);
      return keep;
    },
    outlets,
  });

  const items = clustered.items.map((item): Item => {
    const original = real.get(item.id) ?? item;
    const coverage = item.signals.coverage ?? 1;
    const { coverage: _own, ...signals } = original.signals;
    return {
      ...original,
      signals: coverage >= 2 ? { ...signals, coverage } : signals,
      topic_ids: [...(topics.get(item.id) ?? [])].sort(),
    };
  });
  const out: Record<string, string[]> = {};
  for (const item of items) {
    const rest = [...(carriers.get(item.id) ?? [])].filter((id) => id !== item.source_id).sort();
    out[item.id] = [item.source_id, ...rest];
  }
  const checked = [...(input.checked ?? [])].sort();
  return {
    version: 1,
    items,
    carriers: out,
    ...(checked.length > 0 ? { checked } : {}),
    report: {
      fetched: input.items.length,
      same_url: sameUrl,
      story_clustered: clustered.merged,
      stories: items.length,
    },
  };
}

/** Most outlets first, then the newest, then id: the order a ceiling keeps stories in. */
export function byCoverageThenRecency(a: Item, b: Item): number {
  return (
    (b.signals.coverage ?? 1) - (a.signals.coverage ?? 1) ||
    timeOf(b) - timeOf(a) ||
    a.id.localeCompare(b.id)
  );
}

/** Keep at most `ceiling` stories, the most widely carried and the newest first. */
export function applyCeiling(
  items: readonly Item[],
  ceiling: number,
  /** True for a story only a weekly check carried (D70): it waits behind every other. */
  checkedOnly: (item: Item) => boolean = () => false,
): { kept: Item[]; over: number } {
  if (items.length <= ceiling) return { kept: [...items], over: 0 };
  const kept = [...items]
    .sort((a, b) => Number(checkedOnly(a)) - Number(checkedOnly(b)) || byCoverageThenRecency(a, b))
    .slice(0, Math.max(0, ceiling));
  return { kept, over: items.length - kept.length };
}

/**
 * Whether a fit clears the bar every other topic is held to: the topic's weight times the fit
 * curve against the score threshold of a briefing. The hype and sponsored discount is left out on
 * purpose, because a source's trust is measured on its own.
 */
export function fitPasses(topic: Pick<Topic, "weight">, value: number): boolean {
  return round4(topic.weight * fitCurve(value)) >= DEFAULT_SCORE_THRESHOLD;
}

export type GeneralCounts = Record<string, SourceCounts>;

/**
 * Per-source counters of the general stories a pass judged, to be added to the briefing counters.
 * A story counts for every source that carried it, because each outlet put it in front of the
 * reader: judged when the judge answered, asked and flagged by the trust questions, passed when
 * any of its topics cleared the bar, and covered when more than one outlet carried it. A story
 * left out by the ceiling, or that Jev did not answer, counts for none of them.
 */
export function countGeneral(input: {
  pool: GeneralPoolFile;
  judged: GeneralJudgedFile;
  topics: readonly Pick<Topic, "id" | "weight">[];
}): GeneralCounts {
  const out: GeneralCounts = {};
  const row = (id: string): Required<SourceCounts> => {
    const made = out[id] ?? { fetched: 0, judged: 0, passed: 0, asked: 0, flagged: 0, covered: 0 };
    out[id] = made;
    return made as Required<SourceCounts>;
  };
  const items = new Map(input.pool.items.map((item) => [item.id, item]));
  const weights = new Map(input.topics.map((topic) => [topic.id, topic]));
  for (const entry of input.judged.entries) {
    const item = items.get(entry.item_id);
    if (!item) continue;
    const passed = Object.entries(entry.fits).some(([topicId, value]) => {
      const topic = weights.get(topicId);
      return topic !== undefined && fitPasses(topic, value);
    });
    const covered = (item.signals.coverage ?? 1) >= 2;
    for (const sourceId of input.pool.carriers[item.id] ?? [item.source_id]) {
      const counts = row(sourceId);
      counts.judged += 1;
      if (passed) counts.passed += 1;
      if (covered) counts.covered += 1;
      if (entry.flags) {
        counts.asked += 1;
        if (isFlagged(entry.flags)) counts.flagged += 1;
      }
    }
  }
  return out;
}

/** Add the general counters to a pass's briefing counters. */
export function mergeGeneralCounts(
  base: Readonly<Record<string, SourceCounts>>,
  general: GeneralCounts,
): Record<string, SourceCounts> {
  const out: Record<string, SourceCounts> = { ...base };
  for (const [id, add] of Object.entries(general)) {
    const before = out[id] ?? { fetched: 0, judged: 0, passed: 0 };
    out[id] = {
      fetched: before.fetched,
      judged: before.judged + add.judged,
      passed: before.passed + add.passed,
      asked: (before.asked ?? 0) + (add.asked ?? 0),
      flagged: (before.flagged ?? 0) + (add.flagged ?? 0),
      covered: (before.covered ?? 0) + (add.covered ?? 0),
    };
  }
  return out;
}
