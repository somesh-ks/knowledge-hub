import type { CategoryOrNone, Item, JudgmentEntry } from "@singularity/core";

/** Every term of a score, so a surprising ranking can be explained from the persisted run. */
export interface ScoreBreakdown {
  /** Sum over categories of probability times preference weight. */
  taste: number;
  /**
   * The depth multiplier. From craft depth, between CRAFT_FLOOR and 1; or, for an item whose
   * most probable category is consumer tech, from launch scale, between TECH_FLOOR and 1.
   */
  craftFactor: number;
  /** Multiplier from the hype, sponsored and funding flags, between 0 and 1. */
  penaltyFactor: number;
  /** Preferred author and keyword bonus, at most 0.05. */
  bonus: number;
  /** Change from the source's 30-day pass rate, within SOURCE_ADJUSTMENT_MAX. Absent when 0. */
  source?: number;
}

/** The custom topic that outscored the built-in categories for an item. */
export interface WinningTopic {
  id: string;
  /** Section the topic publishes in. */
  section_id: string;
  never_publish: boolean;
  /** Normalized fit the judge gave, 0 to 1. */
  fit: number;
}

export interface ScoredItem {
  item: Item;
  entry: JudgmentEntry;
  /** 0 to 1, four decimals. */
  score: number;
  /**
   * Most probable of the twelve built-in options. Decides the section and which depth answer is
   * used when no custom topic won; kept when one did, as the nearest built-in category.
   */
  topCategory: CategoryOrNone;
  breakdown: ScoreBreakdown;
  /** The weight of `topCategory`, so a category at Off is refused even where no weights are passed. */
  categoryWeight?: number | undefined;
  /** Set only when a custom topic scored higher than the built-in categories. */
  topic?: WinningTopic;
}

/** A chosen item before its final section is assigned. */
export interface Candidate {
  item: Item;
  /** A built-in category, or the id of the custom topic that won. */
  category: string;
  /** Home section of the category or topic (or "watch" for video). */
  home: string;
  score: number;
}

/**
 * A chosen item with its final section: "top" for the three highest scores outside Tech releases,
 * otherwise home.
 */
export interface SelectedItem extends Candidate {
  section: string;
}
