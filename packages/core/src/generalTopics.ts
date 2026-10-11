import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_FILES } from "./paths.js";

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

/** One open category feed of a general outlet. Feeds only: nothing here needs a key or Firecrawl. */
export const GeneralFeed = z.object({
  /** Lowercase letters, digits and hyphens; names the outlet and, with the topic, the feed. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** The outlet's name as a listener hears it and as the episode lists it. */
  name: z.string().min(1),
  feed_url: z.string().url(),
});
export type GeneralFeed = z.infer<typeof GeneralFeed>;

/** Shape of config/general-feeds.json: a list of feeds for each general topic. */
export const GeneralFeeds = z.object({
  version: z.literal(1),
  topics: z.object({
    world: z.array(GeneralFeed),
    business: z.array(GeneralFeed),
    technology: z.array(GeneralFeed),
    science: z.array(GeneralFeed),
    culture: z.array(GeneralFeed),
    sports: z.array(GeneralFeed),
  }),
});
export type GeneralFeeds = z.infer<typeof GeneralFeeds>;

export function parseGeneralFeeds(json: unknown): GeneralFeeds {
  return GeneralFeeds.parse(json);
}

/** config/general-feeds.json. A missing file is an error: a general episode has nothing to read without it. */
export async function loadGeneralFeeds(root: string): Promise<GeneralFeeds> {
  const text = await readFile(join(root, CONFIG_FILES.generalFeeds), "utf8");
  return parseGeneralFeeds(JSON.parse(text) as unknown);
}
