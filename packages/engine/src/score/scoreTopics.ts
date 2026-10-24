import {
  deriveSourceFormat,
  type FormatMix,
  type Item,
  type JudgmentEntry,
  mixFactor,
  type Preferences,
  perspectiveFactor,
  type Source,
  type SourceFormat,
  sourceFormat,
  type Topic,
} from "@singularity/core";
import type { TopicFits } from "../judge/topicJudge.js";
import { clamp01, round4 } from "./numbers.js";
import { craftFactor, launchFactor, penaltyFactor, scoreItem } from "./scoreItem.js";
import type { ScoredItem } from "./types.js";

/**
 * Custom-topic scoring, layered over the built-in score without touching it.
 *
 *   topic score = weight x curve(fit) x penaltyFactor [x depth factor, for craft and launch topics]
 *   final score = the larger of the built-in score and the best topic score
 *
 * curve(fit) = fit^1.5. The judge's expected level (0 to 4) is normalized to `fit` in 0..1, and the
 * exponent makes the middle of the scale count for less than the ends: a topic at weight 0.7 needs
 * roughly "clearly about it" (level 3, score 0.455) to clear the 0.4 bar, while "loosely tied"
 * (level 2, 0.25) does not. The built-in depth curve is concave because a good overview should
 * not be buried; a topic the reader asked for by name should only publish what is really on it.
 *
 * `penaltyFactor` is the same hype, sponsored and funding discount the built-in score uses, so a
 * promotional post on a favourite topic is held back as it would be anywhere else. There is no
 * author or keyword bonus: the topic's keywords already decided whether it was judged at all.
 *
 * A "fit_only" topic stops there. A "craft" topic also multiplies by the craft-depth factor and a
 * "launch" topic by the launch-scale factor, which suits a topic that is about technique or about
 * product releases.
 */
export const FIT_EXPONENT = 1.5;

/**
 * Multiplier for a "coverage" topic (Trending, D40) from the number of distinct outlets that
 * reported the story. One outlet is 0, so such a story never publishes; two is 0.7, rising 0.15
 * per extra outlet to 1 at four. Computed by code from the clustering, at no model cost.
 *
 * A topic in SINGLE_OUTLET_TOPICS gives one outlet 0.65 instead: a story that is clearly on it
 * (judge level 3, curve 0.65) just clears the 0.4 bar, one that is loosely tied does not, and a
 * story two outlets carried still ranks above it.
 */
export function coverageFactor(coverage: number | undefined, singleOutlet = false): number {
  if (coverage === undefined || coverage < 2) return singleOutlet ? SINGLE_OUTLET_FACTOR : 0;
  return Math.min(1, 0.55 + 0.15 * (coverage - 1));
}

/**
 * Science's feeds are mostly press releases that no second outlet carries (ScienceDaily sent 31
 * stories in a week, none twice), so under the two-outlet rule Science never aired. The owner
 * chose to let Science alone take a one-outlet story (D120); the other general topics are well
 * co-covered and keep the rule.
 */
const SINGLE_OUTLET_TOPICS: ReadonlySet<string> = new Set(["science"]);
const SINGLE_OUTLET_FACTOR = 0.65;

export function fitCurve(fit: number): number {
  return clamp01(fit) ** FIT_EXPONENT;
}

/** What a source adds to the score of its stories: its format, and a general source's lean. */
export interface SourceFacts {
  format: SourceFormat;
  lean?: number | null | undefined;
}

/** The facts of every source, by id. */
export function sourceFactsMap(sources: readonly Source[]): Record<string, SourceFacts> {
  return Object.fromEntries(sources.map((s) => [s.id, { format: sourceFormat(s), lean: s.lean }]));
}

/** What the type mix and a topic's perspective read about one story. */
export interface StoryFacts {
  format?: SourceFormat | undefined;
  /** The lean of each outlet that carried it; an unrated outlet counts as 0 (Centre). */
  leans?: readonly number[] | undefined;
}

/**
 * The facts of a story: its source's format (the type's rule where the source is unknown) and the
 * lean of every outlet that carried it (`carriers`, the kept item's source first).
 */
export function storyFacts(
  item: Pick<Item, "source_id" | "source_type">,
  sources: Readonly<Record<string, SourceFacts>> | undefined,
  carriers?: readonly string[],
): StoryFacts {
  const own = sources?.[item.source_id];
  const ids = carriers && carriers.length > 0 ? carriers : [item.source_id];
  return {
    format: own?.format ?? deriveSourceFormat(item.source_type),
    leans: ids.map((id) => sources?.[id]?.lean ?? 0),
  };
}

/** What scoring needs to know about the custom topics of a run. */
export interface TopicLayer {
  /** Enabled custom topics only. */
  topics: readonly Topic[];
  fits: TopicFits;
  /** Source facts by id, for perspective. Absent reads every story by its source type's rule. */
  sources?: Readonly<Record<string, SourceFacts>>;
}

/**
 * The score one topic would give an item, or null when the topic was not judged for it. The topic's
 * format mix multiplies the score by its source's format (Off makes it 0) and, for a general topic,
 * the perspective by its outlets' mean lean; both come last, and the result is clamped to 0..1.
 */
export function topicScore(
  topic: Topic,
  fit: number | undefined,
  entry: JudgmentEntry,
  item?: Pick<Item, "signals">,
  story?: StoryFacts,
): { score: number; curve: number; depth: number; penalty: number } | null {
  if (fit === undefined) return null;
  const curve = fitCurve(fit);
  const depth =
    topic.depth === "craft"
      ? craftFactor(entry.craft_depth)
      : topic.depth === "launch"
        ? launchFactor(entry.launch_scale ?? 0)
        : topic.depth === "coverage"
          ? coverageFactor(item?.signals.coverage, SINGLE_OUTLET_TOPICS.has(topic.id))
          : 1;
  const penalty = penaltyFactor(entry.flags);
  // The type mix is the same for every topic and is applied once, after scoring (applyFormatMix).
  const lean =
    topic.origin === "general" ? perspectiveFactor(topic.perspective, story?.leans ?? []) : 1;
  return {
    score: round4(clamp01(topic.weight * curve * depth * penalty * lean)),
    curve,
    depth,
    penalty,
  };
}

/**
 * The type mix (config/preferences.json), one for every topic: a story's score is multiplied by
 * the stop of its source's format; Off scores it 0, which keeps it out whichever category or topic
 * scored it. A format at Normal, or a story whose format is unknown, is left alone.
 */
export function applyFormatMix(
  scored: ScoredItem,
  mix: FormatMix | undefined,
  sources: Readonly<Record<string, SourceFacts>> | undefined,
): ScoredItem {
  const format = mix && storyFacts(scored.item, sources).format;
  const factor = mixFactor(format && mix?.[format]);
  return factor === 1 ? scored : { ...scored, score: round4(clamp01(scored.score * factor)) };
}

/**
 * Let the custom topics compete with an item's built-in score. A topic wins only by scoring
 * strictly higher, so with no custom topics, or none judged for the item, the result is the very
 * object that came in. The winning topic decides the section and whether the story may publish.
 */
export function applyTopics(scored: ScoredItem, layer: TopicLayer | undefined): ScoredItem {
  if (!layer || layer.topics.length === 0) return scored;
  const row = layer.fits[scored.item.id];
  if (!row) return scored;
  let best: {
    topic: Topic;
    fit: number;
    result: NonNullable<ReturnType<typeof topicScore>>;
  } | null = null;
  for (const topic of layer.topics) {
    const fit = row[topic.id];
    const result = topicScore(
      topic,
      fit,
      scored.entry,
      scored.item,
      storyFacts(scored.item, layer.sources),
    );
    if (!result || fit === undefined) continue;
    // A story from a Trending outlet publishes in Trending or nowhere: general news never
    // enters another section because a built-in category happens to score it higher.
    if (topic.depth === "coverage" && scored.item.topic_ids?.includes(topic.id)) {
      best = { topic, fit, result };
      break;
    }
    if (best === null || result.score > best.result.score) best = { topic, fit, result };
  }
  const forced = best !== null && best.topic.depth === "coverage";
  if (best === null || (!forced && best.result.score <= scored.score)) return scored;
  return {
    ...scored,
    score: best.result.score,
    breakdown: {
      taste: round4(best.topic.weight),
      craftFactor: round4(best.result.curve * best.result.depth),
      penaltyFactor: round4(best.result.penalty),
      bonus: 0,
    },
    topic: {
      id: best.topic.id,
      section_id: best.topic.section_id,
      never_publish: best.topic.never_publish,
      fit: best.fit,
    },
  };
}

/** The built-in score with the custom topics applied. Pure and deterministic. */
export function scoreWithTopics(
  entry: JudgmentEntry,
  preferences: Preferences,
  item: Item,
  layer: TopicLayer | undefined,
): ScoredItem {
  return applyTopics(scoreItem(entry, preferences, item), layer);
}
