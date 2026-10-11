import { DESIGN_TOPIC_ID, TECH_CATEGORY } from "./categories.js";

/**
 * The owner's three topics (D69): what the app shows as Design, AI and Technology. Each gathers
 * the judge's finer topics by the briefing section they publish to, so the eleven built-in
 * categories, the app's Design topic and any custom topic in those sections stay the judge's
 * questions underneath while a person sees three. `home` is where a source added to the group is
 * filed. A topic that never publishes, Trending and a custom topic with its own section belong to
 * none.
 */
export interface TopicGroup {
  id: string;
  name: string;
  /** The briefing sections whose topics the group gathers. */
  sections: readonly string[];
  /** The topic a source added to the group is filed under. */
  home: string;
  /** One line on what the group covers, for its page. */
  note: string;
}

export const TOPIC_GROUPS: readonly TopicGroup[] = [
  {
    id: "design",
    name: "Design",
    sections: ["design", "ui-craft"],
    home: DESIGN_TOPIC_ID,
    note: "Product, interface and design engineering: craft, components, motion, tools and research.",
  },
  {
    id: "ai",
    name: "AI",
    sections: ["ai"],
    home: "frontier_model_releases",
    note: "AI products and model releases, and the patterns people use them through.",
  },
  {
    id: "tech",
    name: "Technology",
    sections: ["tech"],
    home: TECH_CATEGORY,
    note: "Consumer technology launches: phones, laptops, chips, operating systems and the rules around them.",
  },
];

/** Ids the groups' pages take; no topic may take one. */
export const TOPIC_GROUP_IDS: readonly string[] = TOPIC_GROUPS.map((group) => group.id);

/** The group a topic belongs to, or null for one that never publishes, a general topic or one apart. */
export function topicGroupOf(topic: {
  section_id: string;
  never_publish: boolean;
  origin: string;
}): TopicGroup | null {
  if (topic.never_publish || topic.origin === "general") return null;
  return TOPIC_GROUPS.find((group) => group.sections.includes(topic.section_id)) ?? null;
}
