import {
  type AutoAdjust,
  adjustmentAt,
  effectiveWeight,
  type Preferences,
  type TopicsFile,
} from "@singularity/core";

/**
 * The preferences and topics a run scores with: each weight is the owner's plus what votes added
 * (core/autoAdjust.ts), kept on 0 to 1. The files on disk keep the owner's weights; a weight at 0
 * (Off) stays off, since a vote must not switch a topic the owner turned off back on.
 */
export function withAutoAdjust(
  preferences: Preferences,
  topics: TopicsFile,
  adjust: AutoAdjust,
  now: Date,
): { preferences: Preferences; topics: TopicsFile } {
  const shift = (id: string, weight: number): number =>
    weight <= 0 ? weight : effectiveWeight(weight, adjustmentAt(adjust.topics[id], now));
  return {
    preferences: {
      ...preferences,
      weights: Object.fromEntries(
        Object.entries(preferences.weights).map(([id, weight]) => [id, shift(id, weight)]),
      ) as Preferences["weights"],
    },
    topics: {
      ...topics,
      topics: topics.topics.map((topic) => ({ ...topic, weight: shift(topic.id, topic.weight) })),
    },
  };
}
