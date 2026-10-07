import { z } from "zod";

/** The ten taste categories. Keys match `weights` in config/preferences.json. */
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
};

/**
 * Home section for a category. Video items go to "watch" by source type, whatever their category.
 * Returns null for categories that never publish.
 */
export function homeSection(category: Category, sourceType: string): Section | null {
  if (sourceType === "youtube") return "watch";
  return HOME_SECTION[category];
}
