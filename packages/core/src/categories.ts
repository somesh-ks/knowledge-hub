import { z } from "zod";

/**
 * The twelve taste categories. Keys match `weights` in config/preferences.json. New categories go
 * at the end, so the order of the earlier ones (which breaks ties in scoring) never shifts.
 */
export const CATEGORIES = [
  "design_engineering_craft",
  "hci_empirical_research",
  "ui_component_primitives",
  "ai_ux_interaction_patterns",
  "css_canvas_motion_techniques",
  "frontier_model_releases",
  "developer_tool_launches",
  "taste_and_design_philosophy",
  "venture_capital_and_gossip",
  "generic_ai_hype_listicles",
  "consumer_tech_releases",
  "software_engineering_depth",
] as const;

export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** A judge may also answer that an item fits none of the categories. */
export const CategoryOrNone = z.enum([...CATEGORIES, "none"]);
export type CategoryOrNone = z.infer<typeof CategoryOrNone>;

/**
 * What every category and topic is scored at: the old Normal stop, "competes on merit". The owner no
 * longer sets a weight per topic (D193), so this one number replaces the stored ones.
 */
export const NORMAL_TASTE = 0.7;

export const SECTIONS = [
  "top",
  "design",
  "ui-craft",
  "software",
  "ai",
  "tech",
  "trending",
  "research",
  "launches",
  "watch",
] as const;
export const Section = z.enum(SECTIONS);
export type Section = z.infer<typeof Section>;

/**
 * Sections no category calls home (D39). They stay known ids so a briefing published before the
 * change keeps its headings and keeps validating. HCI research now goes to Design and a video to
 * the section of its topic. Launches is filed again since 2026-10-18: library, framework and
 * changelog news goes there and is read last (the engine's releaseNotes.ts).
 */
export const RETIRED_SECTIONS = ["research", "launches", "watch"] as const;

export function isRetiredSection(id: string): boolean {
  return (RETIRED_SECTIONS as readonly string[]).includes(id);
}

/**
 * An id for a category, topic or section as it is persisted: lowercase letters, digits, hyphens
 * and underscores. Digests store these as plain strings, not as the built-in enums, so a briefing
 * written for a custom topic still parses after that topic is removed.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
export const ID_MAX_LENGTH = 64;
export const IdString = z.string().min(1).max(ID_MAX_LENGTH).regex(ID_PATTERN);
export type IdString = z.infer<typeof IdString>;

/** Id of a section as stored in a digest: a built-in section or one a custom topic defined. */
export const SectionId = IdString;
export type SectionId = IdString;

/** Id of a category as stored in a digest: a built-in category or a custom topic. */
export const CategoryId = IdString;
export type CategoryId = IdString;

export function isBuiltinSection(id: string): id is Section {
  return (SECTIONS as readonly string[]).includes(id);
}

export function isBuiltinCategory(id: string): id is Category {
  return (CATEGORIES as readonly string[]).includes(id);
}

export const SECTION_TITLES: Record<Section, string> = {
  top: "Top picks",
  design: "Design",
  "ui-craft": "Design Engineering",
  software: "Software Engineering",
  ai: "AI Products",
  tech: "Tech Product Launches",
  trending: "Trending",
  research: "Research",
  launches: "Launches",
  watch: "Watch and listen",
};

const HOME_SECTION: Record<Category, Section | null> = {
  design_engineering_craft: "ui-craft",
  ui_component_primitives: "ui-craft",
  css_canvas_motion_techniques: "ui-craft",
  taste_and_design_philosophy: "ui-craft",
  developer_tool_launches: "software",
  software_engineering_depth: "software",
  ai_ux_interaction_patterns: "ai",
  frontier_model_releases: "ai",
  hci_empirical_research: "design",
  venture_capital_and_gossip: "ai",
  generic_ai_hype_listicles: "ai",
  consumer_tech_releases: "tech",
};

/** The category behind the Tech Product Launches section. Ranked by launch scale instead of craft depth. */
export const TECH_CATEGORY = "consumer_tech_releases" satisfies Category;

/** The section with its own allowance of items. Its stories never move to Top picks. */
export const TECH_SECTION = "tech" satisfies Section;

/** Ids of the two topics that ship with the app (D39). Both are judged by fit, like a custom topic. */
export const DESIGN_TOPIC_ID = "design";
export const TRENDING_TOPIC_ID = "trending";

/** The Trending section: stories several outlets cover at once. Own allowance, never a Top pick. */
export const TRENDING_SECTION = "trending" satisfies Section;

/** A story is Trending only when at least this many distinct outlets reported it... */
export const TRENDING_MIN_OUTLETS = 2;
/** ...within this many hours of each other. */
export const TRENDING_WINDOW_HOURS = 48;

/**
 * True for a section that takes its stories from an allowance of its own, outside the main cap:
 * Tech Product Launches, Trending, and every section a custom topic defines. A custom topic
 * placed in a built-in section shares that section's room under the main cap instead, as Design
 * does.
 */
export function hasOwnAllowance(section: string): boolean {
  return section === TECH_SECTION || section === TRENDING_SECTION || !isBuiltinSection(section);
}

/**
 * Home section for a category. A video goes to the section of its category like any other story;
 * "watch" no longer receives stories (D39). The source type stays in the signature so callers
 * need not change. Every category has one: a category never publishes by sitting at weight 0, not by having no home.
 */
export function homeSection(category: Category, _sourceType?: string): Section | null {
  return HOME_SECTION[category];
}
