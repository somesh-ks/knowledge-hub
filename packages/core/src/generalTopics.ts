/**
 * The general news topics (D43, D66), in the order the form shows them. Each is a topic of
 * config/topics.json with origin "general" (see generalTopics in topics.ts): fed by its own news
 * feeds, judged so its sources earn scores, published only in episodes, never in a briefing. These
 * titles are the defaults; the owner can rename a topic in the app. Technology is not here: the
 * owner's own Technology (the `tech` section) took its place, and `technology` survives only as an
 * alias in stored requests (normalizeTopicIds).
 */
export const GENERAL_TOPICS = [
  { id: "world", title: "World" },
  { id: "business", title: "Business" },
  { id: "science", title: "Science" },
  { id: "culture", title: "Culture" },
  { id: "sports", title: "Sports" },
] as const;

export type GeneralTopicId = (typeof GENERAL_TOPICS)[number]["id"];

const GENERAL_IDS: readonly string[] = GENERAL_TOPICS.map((topic) => topic.id);

export function isGeneralTopicId(id: string): id is GeneralTopicId {
  return GENERAL_IDS.includes(id);
}

/** Title of a general topic id, or the id itself when it is not one. */
export function generalTopicTitle(id: string): string {
  return GENERAL_TOPICS.find((topic) => topic.id === id)?.title ?? id;
}

/**
 * Ids a stored request may hold that now mean something else: the general `technology` topic read
 * four news desks, and the owner's Technology (the `tech` section) replaced it (D66).
 */
export const LEGACY_TOPIC_ALIASES: Readonly<Record<string, string>> = { technology: "tech" };

/** A request's topic ids with legacy aliases replaced and duplicates dropped, in their order. */
export function normalizeTopicIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => LEGACY_TOPIC_ALIASES[id] ?? id))];
}

/**
 * True for a source that feeds general news topics alone (D66): it has topics, and every one is a
 * general topic. Its stories are judged for the feed's score and read by episodes, never published
 * in a briefing, so its score reads `covered` where other sources read `published`.
 */
export function feedsGeneralOnly(topicIds: readonly string[] | undefined): boolean {
  return topicIds !== undefined && topicIds.length > 0 && topicIds.every(isGeneralTopicId);
}
