import { DESIGN_TOPIC_ID, TECH_CATEGORY } from "./categories.js";

/**
 * The owner's four topics (D69, D151): what the app shows as Design, AI, Technology and Software Engineering. Each gathers
 * the judge's finer topics by the briefing section they publish to, so the twelve built-in
 * categories, the app's Design topic and any custom topic in those sections stay the judge's
 * questions underneath while a person sees four. `home` is where a source added to the group is
 * filed. A custom topic that never publishes, Trending and a custom topic with its own section belong to
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
  {
    id: "software",
    name: "Software Engineering",
    sections: ["software"],
    home: "developer_tool_launches",
    note: "Tools, languages and frameworks, and the architecture, performance and internals behind them.",
  },
];

/** Ids the groups' pages take; no topic may take one. */
export const TOPIC_GROUP_IDS: readonly string[] = TOPIC_GROUPS.map((group) => group.id);

/**
 * The topic a group's page keeps its settings on (its format mix): the group's home, or its first
 * member when the home is not among the topics. The page, the engine and the config ops all ask
 * here, so a mix is saved where it is read.
 */
export function groupHomeId(
  group: TopicGroup,
  topics: readonly { id: string; section_id: string; never_publish: boolean; origin: string }[],
): string {
  const members = topics.filter((topic) => topicGroupOf(topic)?.id === group.id);
  return members.some((topic) => topic.id === group.home)
    ? group.home
    : (members[0]?.id ?? group.home);
}

/** The group a topic belongs to, or null for one that never publishes, a general topic or one apart. */
export function topicGroupOf(topic: {
  section_id: string;
  never_publish: boolean;
  origin: string;
}): TopicGroup | null {
  // A built-in topic at Off keeps its page, so it can be turned on again.
  if ((topic.never_publish && topic.origin !== "builtin") || topic.origin === "general")
    return null;
  return TOPIC_GROUPS.find((group) => group.sections.includes(topic.section_id)) ?? null;
}
