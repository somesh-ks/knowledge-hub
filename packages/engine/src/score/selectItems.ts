import {
  CATEGORIES,
  type Category,
  type DigestKind,
  homeSection,
  type Item,
  NEVER_PUBLISH,
  SECTIONS,
  type Section,
  TECH_SECTION,
  VOICE_LIMITS,
} from "@dispatch/core";
import type { Candidate, ScoredItem, SelectedItem } from "./types.js";

/**
 * Minimum score to publish. A starting value: it is tuned on the golden set (see eval/), and
 * lives in code, never in a prompt. An off-taste item with no craft cannot reach it, while a
 * frontier-model announcement (weight 0.85, depth 0) lands just above it.
 */
export const DEFAULT_SCORE_THRESHOLD = 0.4;

/** Items taken per home section before overflow is allowed. Does not apply to Tech releases. */
export const SECTION_TARGET_MAX = 3;

/** Top picks: the highest-scoring items outside Tech releases, moved out of their home section. */
export const TOP_PICKS = 3;

export type DropReason =
  | "no_category"
  | "never_publish"
  | "below_threshold"
  | "over_cap"
  /** A Tech releases candidate beyond that section's own allowance. */
  | "over_tech_cap";

export interface DroppedItem {
  id: string;
  reason: DropReason;
  score: number;
}

export interface SelectInput {
  scored: readonly ScoredItem[];
  kind: DigestKind;
  /** Fewer qualifying items than this returns the "nothing" outcome. */
  floor: number;
  /**
   * Requested cap for everything outside Tech releases; never raised above the hard cap for the
   * kind (12, weekly 18). Tech releases has its own allowance on top of it.
   */
  cap: number;
  /**
   * Preference weights. Only the weekly kind needs them, to find the category median for the
   * reserved off-taste slot. Without them no slot is reserved.
   */
  weights?: Record<Category, number>;
  threshold?: number;
}

export interface SelectResult {
  outcome: "selected" | "nothing";
  /** In digest order: top picks first, then sections in SECTIONS order, each by score. */
  selected: SelectedItem[];
  dropped: DroppedItem[];
  /** Items that cleared the threshold before the cap and section targets applied. */
  qualifying: number;
}

/** Hard cap on items outside Tech releases, for a digest kind. */
export function capFor(kind: DigestKind): number {
  return kind === "weekly" ? VOICE_LIMITS.items.weeklyCap : VOICE_LIMITS.items.cap;
}

/** Items the Tech releases section may hold, in addition to `capFor`. The same for every kind. */
export const TECH_CAP = VOICE_LIMITS.items.techCap;

/** True for a candidate that belongs in the Tech releases section. A tech video belongs in "watch". */
export function isTech(candidate: Pick<Candidate, "home">): boolean {
  return candidate.home === TECH_SECTION;
}

/**
 * Median of the eleven preference weights: the middle one. The even branch is for the day a
 * twelfth category arrives, when it becomes the mean of the middle two.
 */
export function medianWeight(weights: Record<Category, number>): number {
  const sorted = CATEGORIES.map((c) => weights[c]).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[Math.floor(mid)] as number);
}

function publishedMs(item: Item): number {
  if (!item.published_at) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(item.published_at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Total order for ranking: higher score, then newer, then lower id. The id step makes ties
 * deterministic whatever order the pool arrived in.
 */
export function compareCandidates(
  a: { item: Item; score: number },
  b: { item: Item; score: number },
): number {
  if (a.score !== b.score) return b.score - a.score;
  const pa = publishedMs(a.item);
  const pb = publishedMs(b.item);
  if (pa !== pb) return pb > pa ? 1 : -1;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

/**
 * Final sections for a chosen set: the three highest scores outside Tech releases become "top",
 * the rest keep their home section. A tech story never moves to Top picks, however high it scores,
 * so with fewer than three other items there are fewer than three picks. Also used after later
 * stages drop items, so top picks always stay the best three that remain.
 */
export function assignSections(chosen: readonly Candidate[]): SelectedItem[] {
  const ranked = [...chosen].sort(compareCandidates);
  let picks = 0;
  const withSection: SelectedItem[] = ranked.map((candidate) => {
    const pick = !isTech(candidate) && picks < TOP_PICKS;
    if (pick) picks += 1;
    return { ...candidate, section: pick ? "top" : candidate.home };
  });
  const order = (section: Section): number => SECTIONS.indexOf(section);
  return withSection.sort((a, b) => {
    if (a.section !== b.section) return order(a.section) - order(b.section);
    return compareCandidates(a, b);
  });
}

export type Eligibility =
  | { eligible: true; candidate: Candidate }
  | { eligible: false; reason: DropReason };

/** Whether a scored item may publish at all, before the cap and section targets apply. */
export function eligibility(
  scored: ScoredItem,
  threshold: number = DEFAULT_SCORE_THRESHOLD,
): Eligibility {
  const category = scored.topCategory;
  if (category === "none") return { eligible: false, reason: "no_category" };
  if (NEVER_PUBLISH.includes(category)) return { eligible: false, reason: "never_publish" };
  const home = homeSection(category, scored.item.source_type);
  if (home === null) return { eligible: false, reason: "never_publish" };
  if (scored.score < threshold) return { eligible: false, reason: "below_threshold" };
  return { eligible: true, candidate: { item: scored.item, category, home, score: scored.score } };
}

/**
 * Pick what to publish. Order of rules:
 *  1. Drop items whose most probable option is "none" or a never-publish category.
 *  2. Drop items below the score threshold.
 *  3. Split what is left into two pools: Tech releases candidates, and everything else.
 *  4. Everything else: walk by rank taking at most 3 per home section up to the cap, then let
 *     overflow fill any remaining room, so a thin section never leaves slots empty.
 *  5. Weekly only: guarantee one of those slots for the best item whose category weight is below
 *     the median of preferences, so taste does not narrow week over week.
 *  6. Tech releases: take the best by rank up to its own allowance of 5, on top of the cap. The
 *     per-section target does not apply, and the pool never borrows from or lends to the cap.
 *  7. Fewer than `floor` chosen across both pools means nothing publishes.
 *  8. Assign sections: the three highest scores outside Tech releases become Top picks.
 */
export function selectItems(input: SelectInput): SelectResult {
  const threshold = input.threshold ?? DEFAULT_SCORE_THRESHOLD;
  const limit = Math.min(input.cap, capFor(input.kind));
  const dropped: DroppedItem[] = [];
  const candidates: Candidate[] = [];

  for (const scored of input.scored) {
    const verdict = eligibility(scored, threshold);
    if (verdict.eligible) candidates.push(verdict.candidate);
    else dropped.push({ id: scored.item.id, reason: verdict.reason, score: scored.score });
  }

  const ranked = candidates.sort(compareCandidates);
  const main = ranked.filter((candidate) => !isTech(candidate));
  const tech = ranked.filter(isTech);

  const chosen = new Set<Candidate>();
  const perSection = new Map<Section, number>();
  const take = (candidate: Candidate): void => {
    chosen.add(candidate);
    perSection.set(candidate.home, (perSection.get(candidate.home) ?? 0) + 1);
  };
  for (const candidate of main) {
    if (chosen.size >= limit) break;
    if ((perSection.get(candidate.home) ?? 0) < SECTION_TARGET_MAX) take(candidate);
  }
  for (const candidate of main) {
    if (chosen.size >= limit) break;
    if (!chosen.has(candidate)) take(candidate);
  }

  // The reserved slot is one of the capped slots, so it is filled from the same pool. Tech
  // releases has an allowance of its own and never needs it.
  if (input.kind === "weekly" && input.weights && limit > 0) {
    const median = medianWeight(input.weights);
    const reserve = main.find((c) => input.weights && input.weights[c.category] < median);
    if (reserve && !chosen.has(reserve)) {
      if (chosen.size >= limit) {
        const lowest = [...chosen].sort(compareCandidates).pop();
        if (lowest) chosen.delete(lowest);
      }
      chosen.add(reserve);
    }
  }

  const chosenTech = tech.slice(0, TECH_CAP);
  if (chosen.size + chosenTech.length < input.floor) {
    return { outcome: "nothing", selected: [], dropped, qualifying: ranked.length };
  }

  for (const candidate of main) {
    if (!chosen.has(candidate)) {
      dropped.push({ id: candidate.item.id, reason: "over_cap", score: candidate.score });
    }
  }
  for (const candidate of tech.slice(TECH_CAP)) {
    dropped.push({ id: candidate.item.id, reason: "over_tech_cap", score: candidate.score });
  }
  return {
    outcome: "selected",
    selected: assignSections([...chosen, ...chosenTech]),
    dropped,
    qualifying: ranked.length,
  };
}
