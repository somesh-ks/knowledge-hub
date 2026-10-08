import {
  type Category,
  DESIGN_TOPIC_ID,
  type Item,
  type Source,
  TECH_CATEGORY,
  TRENDING_TOPIC_ID,
} from "@dispatch/core";

/**
 * The category an item is expected to fall in, before any judge has seen it. The source's own
 * hint comes first, because a person curated it; an item found by a discovery query falls back
 * to the hint that query carries.
 */
export function categoryHint(
  item: Pick<Item, "category_hint">,
  source: Pick<Source, "category_hint"> | undefined,
): Category | undefined {
  return source?.category_hint ?? item.category_hint;
}

/**
 * True when the item's source (or, for an item a discovery query found, the query) is tagged with
 * the topic. A tag on the source decides: an item merged into another source's story does not
 * inherit it.
 */
export function isTopicTagged(
  item: Pick<Item, "topic_ids">,
  source: Pick<Source, "topic_ids"> | undefined,
  topicId: string,
): boolean {
  return (source?.topic_ids ?? item.topic_ids)?.includes(topicId) === true;
}

/** True for an item from a general news outlet: a source tagged for Trending (D40). */
export function isTrendingHinted(
  item: Pick<Item, "topic_ids">,
  source: Pick<Source, "topic_ids"> | undefined,
): boolean {
  return isTopicTagged(item, source, TRENDING_TOPIC_ID);
}

/** True for an item from a design outlet: a source tagged for Design (D39). */
export function isDesignHinted(
  item: Pick<Item, "topic_ids">,
  source: Pick<Source, "topic_ids"> | undefined,
): boolean {
  return isTopicTagged(item, source, DESIGN_TOPIC_ID);
}

/** True for an item from the consumer tech beat: a tech-hinted source or a tech-hinted query. */
export function isTechHinted(
  item: Pick<Item, "category_hint">,
  source: Pick<Source, "category_hint"> | undefined,
): boolean {
  return categoryHint(item, source) === TECH_CATEGORY;
}
