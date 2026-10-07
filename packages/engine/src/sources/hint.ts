import { type Category, type Item, type Source, TECH_CATEGORY } from "@dispatch/core";

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

/** True for an item from the consumer tech beat: a tech-hinted source or a tech-hinted query. */
export function isTechHinted(
  item: Pick<Item, "category_hint">,
  source: Pick<Source, "category_hint"> | undefined,
): boolean {
  return categoryHint(item, source) === TECH_CATEGORY;
}
