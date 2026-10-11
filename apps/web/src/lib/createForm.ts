import type { PodcastRequest } from "../types/contracts";

/**
 * What the Create page offers, and what it says about a choice. Build time only: the page script
 * ships to the browser on its own and reads the pace from the markup, so the two cannot drift.
 */

// The limits the server enforces, so the form can never offer more than it accepts.
export { MAX_TITLE_CHARS } from "../server/podcast";

export const LENGTHS: ReadonlyArray<{ value: PodcastRequest["length_minutes"]; label: string }> = [
  { value: 3, label: "3 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
];

export const FORMATS: ReadonlyArray<{ value: PodcastRequest["format"]; label: string }> = [
  { value: "readout", label: "Readout" },
  { value: "discussion", label: "Discussion" },
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
}> = [
  { value: "general", label: "General" },
  { value: "custom", label: "Somesh" },
];

export const DEFAULTS = {
  audience: "custom",
  length: 5,
  format: "readout",
  window: 7,
  tone: "neutral",
} as const;

/** The button names what it makes and how long it will run: "Generate • 10 mins". */
export function submitLabel(minutes: number): string {
  return `Generate • ${minutes} mins`;
}

export interface TopicOption {
  /** The chip's key. For the owner's own topics it is the section id. */
  value: string;
  label: string;
  /** What the chip adds to the request: briefing section ids or general topic ids, in order. */
  ids: readonly string[];
  /** The audiences whose preset ticks this chip. */
  presets: ReadonlyArray<NonNullable<PodcastRequest["audience"]>>;
}

/**
 * The chips every episode can draw on, in the order the form lists them. One list for both
 * audiences: the audience only chooses which are ticked. A chip expands to its ids when the form
 * builds the request, so topic_ids stay plain section or general topic ids. Design folds Design
 * Engineering in; Technology is the owner's own tech sources, not the general feeds. Top picks is
 * not here: an episode always opens with the top picks of its window.
 */
const CHIPS: readonly TopicOption[] = [
  { value: "design", label: "Design", ids: ["design", "ui-craft"], presets: ["custom"] },
  { value: "ai", label: "AI", ids: ["ai"], presets: ["custom"] },
  { value: "technology", label: "Technology", ids: ["tech"], presets: ["custom", "general"] },
  { value: "world", label: "World", ids: ["world"], presets: ["general"] },
  { value: "business", label: "Business", ids: ["business"], presets: ["general"] },
  { value: "science", label: "Science", ids: ["science"], presets: ["general"] },
  { value: "culture", label: "Culture", ids: ["culture"], presets: ["general"] },
  { value: "sports", label: "Sports", ids: ["sports"], presets: ["general"] },
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
 * The chips to offer: the eight above, then the owner's own topics (the custom ones that are on),
 * each by the section it publishes to and only when no chip already sends that section. Their
 * titles come from config/topics.json. Own topics are in no preset.
 */
export function topicOptions(
  sections: ReadonlyArray<{ id: string; title: string }>,
  topics: readonly TopicInfo[],
): TopicOption[] {
  const titles = new Map(sections.map((section) => [section.id, section.title]));
  const taken = new Set(["top", ...CHIPS.flatMap((chip) => chip.ids)]);
  const own: TopicOption[] = [];
  for (const topic of topics) {
    if (topic.origin !== "custom" || !topic.enabled || topic.never_publish) continue;
    if (taken.has(topic.section_id)) continue;
    taken.add(topic.section_id);
    own.push({
      value: topic.section_id,
      label: titles.get(topic.section_id) ?? topic.name,
      ids: [topic.section_id],
      presets: [],
    });
  }
  return [...CHIPS, ...own];
}
