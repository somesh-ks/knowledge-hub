import { z } from "zod";

/**
 * The eleven taste categories. Keys match `weights` in config/preferences.json. New categories go
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
] as const;

export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** A judge may also answer that an item fits none of the categories. */
export const CategoryOrNone = z.enum([...CATEGORIES, "none"]);
export type CategoryOrNone = z.infer<typeof CategoryOrNone>;

/** Categories that never publish, whatever their score. */
export const NEVER_PUBLISH: readonly Category[] = [
  "venture_capital_and_gossip",
  "generic_ai_hype_listicles",
];

export const SECTIONS = ["top", "ui-craft", "ai", "tech", "research", "launches", "watch"] as const;
export const Section = z.enum(SECTIONS);
export type Section = z.infer<typeof Section>;

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
  "ui-craft": "Interaction craft",
  ai: "AI models and products",
  tech: "Tech releases",
  research: "Research",
  launches: "Launches",
  watch: "Watch and listen",
};

const HOME_SECTION: Record<Category, Section | null> = {
  design_engineering_craft: "ui-craft",
  ui_component_primitives: "ui-craft",
  css_canvas_motion_techniques: "ui-craft",
  taste_and_design_philosophy: "ui-craft",
  ai_ux_interaction_patterns: "ai",
  frontier_model_releases: "ai",
  hci_empirical_research: "research",
  developer_tool_launches: "launches",
  venture_capital_and_gossip: null,
  generic_ai_hype_listicles: null,
  consumer_tech_releases: "tech",
};

/** The category behind the Tech releases section. Ranked by launch scale instead of craft depth. */
export const TECH_CATEGORY = "consumer_tech_releases" satisfies Category;

/** The section with its own allowance of items. Its stories never move to Top picks. */
export const TECH_SECTION = "tech" satisfies Section;

/**
 * True for a section that takes its stories from an allowance of its own, outside the main cap:
 * Tech releases, and every section a custom topic defines. A custom topic placed in a built-in
 * section shares that section's room under the main cap instead.
 */
export function hasOwnAllowance(section: string): boolean {
  return section === TECH_SECTION || !isBuiltinSection(section);
}

/**
 * Home section for a category. Video items go to "watch" by source type, whatever their category.
 * Returns null for categories that never publish.
 */
export function homeSection(category: Category, sourceType: string): Section | null {
  if (sourceType === "youtube") return "watch";
  return HOME_SECTION[category];
}
