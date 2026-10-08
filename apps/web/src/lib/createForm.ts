import type { PodcastRequest } from "../types/contracts";
import { CHARS_PER_MINUTE } from "./episodeFile";
import { pluralize } from "./format";

/**
 * What the Create page offers, and what it says about a choice. Build time only: the page script
 * ships to the browser on its own and reads the pace from the markup, so the two cannot drift.
 */

// The limits the server enforces, so the form can never offer more than it accepts.
export { MAX_TITLE_CHARS, MAX_TOPICS } from "../server/podcast";

export const LENGTHS: ReadonlyArray<{ value: PodcastRequest["length_minutes"]; label: string }> = [
  { value: 3, label: "3 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
];

export const FORMATS: ReadonlyArray<{
  value: PodcastRequest["format"];
  label: string;
  hint: string;
}> = [
  { value: "readout", label: "Readout", hint: "One host tells each story." },
  { value: "discussion", label: "Discussion", hint: "Two hosts talk it through." },
  { value: "headlines", label: "Headlines", hint: "Quick hits, a line or two each." },
];

export const WINDOWS: ReadonlyArray<{ value: PodcastRequest["window_days"]; label: string }> = [
  { value: 2, label: "2 days" },
  { value: 7, label: "A week" },
  { value: 30, label: "A month" },
];

export const TONES: ReadonlyArray<{ value: PodcastRequest["tone"]; label: string }> = [
  { value: "neutral", label: "Neutral" },
  { value: "energetic", label: "Energetic" },
  { value: "dry", label: "Dry" },
];

export const AUDIENCES: ReadonlyArray<{
  value: NonNullable<PodcastRequest["audience"]>;
  label: string;
  hint: string;
  /** The line about how an episode opens, which says "top stories" in General mode. */
  top: string;
}> = [
  {
    value: "general",
    label: "General",
    hint: "Written for anyone. Explains terms as it goes.",
    top: "Every episode opens with the day's top stories.",
  },
  {
    value: "custom",
    label: "Somesh mode",
    hint: "Written for you. Also draws on your own topics.",
    top: "Every episode opens with the top picks.",
  },
];

export const DEFAULTS = {
  audience: "custom",
  length: 5,
  format: "readout",
  window: 7,
  tone: "neutral",
} as const;

/** "About 5 minutes, roughly 4,800 characters of narration." */
export function estimateText(minutes: number): string {
  const characters = (minutes * CHARS_PER_MINUTE).toLocaleString("en-US");
  return `About ${pluralize(minutes, "minute")}, roughly ${characters} characters of narration.`;
}

export interface TopicOption {
  /** A section id. */
  value: string;
  label: string;
  /** The mode that offers it: General shows the general topics, Somesh mode the rest. */
  mode: NonNullable<PodcastRequest["audience"]>;
}

/**
 * The topics every episode can draw on, in the order the app lists them. Top picks is not here: an
 * episode always opens with the top picks of its window, so it is never a choice. The titles are
 * only a fallback; config/topics.json names the sections and wins.
 */
export const CREATE_SECTIONS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "design", title: "Design" },
  { id: "ui-craft", title: "Design Engineering" },
  { id: "ai", title: "AI Products" },
  { id: "tech", title: "Tech Product Launches" },
  { id: "trending", title: "Trending" },
];

/**
 * What General mode offers instead of the five above: the topics of a general news podcast. The
 * engine defines the same ids; none is a design topic or one of the owner's.
 */
export const GENERAL_TOPICS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "world", title: "World" },
  { id: "business", title: "Business" },
  { id: "technology", title: "Technology" },
  { id: "science", title: "Science" },
  { id: "culture", title: "Culture" },
  { id: "sports", title: "Sports" },
];

/** What topicOptions needs to know of a topic in config/topics.json. */
export interface TopicInfo {
  name: string;
  section_id: string;
  origin: "builtin" | "custom";
  enabled: boolean;
  never_publish: boolean;
}

/**
 * The topics to offer: always the five above, whether or not a recent briefing has stories in them,
 * titled as config/topics.json titles their sections. After them come the owner's own topics (the
 * custom ones that are on), each by the section it publishes to and only when that section is not
 * one of the five already; the form shows these in Somesh mode mode only.
 */
export function topicOptions(
  sections: ReadonlyArray<{ id: string; title: string }>,
  topics: readonly TopicInfo[],
): TopicOption[] {
  const titles = new Map(sections.map((section) => [section.id, section.title]));
  const offered = CREATE_SECTIONS.map(({ id, title }) => ({
    value: id,
    label: titles.get(id) ?? title,
    mode: "custom" as const,
  }));
  const taken = new Set(["top", ...CREATE_SECTIONS.map((section) => section.id)]);
  const own: TopicOption[] = [];
  for (const topic of topics) {
    if (topic.origin !== "custom" || !topic.enabled || topic.never_publish) continue;
    if (taken.has(topic.section_id)) continue;
    taken.add(topic.section_id);
    own.push({
      value: topic.section_id,
      label: titles.get(topic.section_id) ?? topic.name,
      mode: "custom",
    });
  }
  return [...offered, ...own];
}

/**
 * Every chip the form renders: the Somesh mode set, then the General set. The form shows the set of
 * the chosen mode and hides the other, so a request only ever holds ids of one mode.
 */
export function createTopicOptions(
  sections: ReadonlyArray<{ id: string; title: string }>,
  topics: readonly TopicInfo[],
): TopicOption[] {
  const general = GENERAL_TOPICS.map(({ id, title }) => ({
    value: id,
    label: title,
    mode: "general" as const,
  }));
  return [...topicOptions(sections, topics), ...general];
}
