import type { Item, JudgmentEntry, Preferences, Topic } from "@dispatch/core";
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
 */
export function coverageFactor(coverage: number | undefined): number {
  if (coverage === undefined || coverage < 2) return 0;
  return Math.min(1, 0.55 + 0.15 * (coverage - 1));
}

export function fitCurve(fit: number): number {
  return clamp01(fit) ** FIT_EXPONENT;
}

/** What scoring needs to know about the custom topics of a run. */
export interface TopicLayer {
  /** Enabled custom topics only. */
  topics: readonly Topic[];
  fits: TopicFits;
}

/** The score one topic would give an item, or null when the topic was not judged for it. */
export function topicScore(
  topic: Topic,
  fit: number | undefined,
  entry: JudgmentEntry,
  item?: Pick<Item, "signals">,
): { score: number; curve: number; depth: number; penalty: number } | null {
  if (fit === undefined) return null;
  const curve = fitCurve(fit);
  const depth =
    topic.depth === "craft"
      ? craftFactor(entry.craft_depth)
      : topic.depth === "launch"
        ? launchFactor(entry.launch_scale ?? 0)
        : topic.depth === "coverage"
          ? coverageFactor(item?.signals.coverage)
          : 1;
  const penalty = penaltyFactor(entry.flags);
  return {
    score: round4(clamp01(topic.weight * curve * depth * penalty)),
    curve,
    depth,
    penalty,
  };
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
    const result = topicScore(topic, fit, scored.entry, scored.item);
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
