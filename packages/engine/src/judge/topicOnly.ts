import type { Item, JudgmentEntry, Topic } from "@singularity/core";
import { normalizeCategoryProbs } from "./jevAnswers.js";

/**
 * Topics that decide an item's section by themselves. A story from a source tagged for a coverage
 * topic (Trending, D40) publishes in that topic or nowhere: `applyTopics` takes the topic's score
 * whatever the built-in categories say. For such an item the six built-in questions cannot change
 * where it goes, so they are not asked. An item carrying a category hint came from a query or a
 * source that wants a built-in category too, and keeps the full set.
 */
export function topicOnlyTopics(item: Item, topics: readonly Topic[]): Topic[] {
  if (item.category_hint !== undefined) return [];
  return topics.filter((topic) => topic.depth === "coverage" && item.topic_ids?.includes(topic.id));
}

export interface NeutralContext {
  model: string;
  questionsHash: string;
  now: Date;
}

/**
 * The judgment a topic-only item scores with: no category, no craft depth, no penalty. The topic
 * score does not read the category or the craft depth, and the hype, sponsored and funding
 * penalties are the one thing it gives up. It stands in for a judgment and is never cached, so a
 * later run that does ask the six questions is not shadowed by it.
 */
export function neutralEntry(item: Item, context: NeutralContext): JudgmentEntry {
  return {
    item_id: item.id,
    model: context.model,
    questions_hash: context.questionsHash,
    judged_at: context.now.toISOString(),
    category_probs: normalizeCategoryProbs({ none: 1 }, "none"),
    craft_depth: 0,
    flags: { hype: 0, sponsored: 0, funding: 0 },
  };
}
