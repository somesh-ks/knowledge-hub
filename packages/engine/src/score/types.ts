import type { Category, CategoryOrNone, Item, JudgmentEntry, Section } from "@dispatch/core";

/** Every term of a score, so a surprising ranking can be explained from the persisted run. */
export interface ScoreBreakdown {
  /** Sum over categories of probability times preference weight. */
  taste: number;
  /** Multiplier from craft depth, between CRAFT_FLOOR and 1. */
  craftFactor: number;
  /** Multiplier from the hype, sponsored and funding flags, between 0 and 1. */
  penaltyFactor: number;
  /** Preferred author and keyword bonus, at most 0.05. */
  bonus: number;
}

export interface ScoredItem {
  item: Item;
  entry: JudgmentEntry;
  /** 0 to 1, four decimals. */
  score: number;
  /** Most probable of the eleven options. Decides the section. */
  topCategory: CategoryOrNone;
  breakdown: ScoreBreakdown;
}

/** A chosen item before its final section is assigned. */
export interface Candidate {
  item: Item;
  category: Category;
  /** Home section of the category (or "watch" for video). */
  home: Section;
  score: number;
}

/** A chosen item with its final section: "top" for the three highest scores, otherwise home. */
export interface SelectedItem extends Candidate {
  section: Section;
}
