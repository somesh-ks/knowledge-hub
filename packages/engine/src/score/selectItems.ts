import {
  CATEGORIES,
  type Category,
  type DigestKind,
  hasOwnAllowance,
  homeSection,
  type Item,
  isBuiltinCategory,
  isBuiltinSection,
  NEVER_PUBLISH,
  SECTIONS,
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
  | "over_tech_cap"
  /** A candidate beyond the allowance of a custom section, or beyond the digest's hard maximum. */
  | "over_section_cap";

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

/**
 * Items each section with an allowance of its own may hold, in addition to `capFor`. The same for
 * every kind and every such section: Tech releases and each section a custom topic defines.
 */
export const TECH_ALLOWANCE = VOICE_LIMITS.items.techCap;

/** True for a candidate that belongs in the Tech releases section. A tech video belongs in "watch". */
export function isTech(candidate: Pick<Candidate, "home">): boolean {
  return candidate.home === TECH_SECTION;
}

/**
 * True for a candidate whose section takes its stories from an allowance of its own, outside the
 * main cap: Tech releases, or a section a custom topic defined. Such stories never move to Top
 * picks, because Top picks is for the best of the main sections.
 */
export function hasOwnSection(candidate: Pick<Candidate, "home">): boolean {
  return hasOwnAllowance(candidate.home);
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
    const pick = !hasOwnSection(candidate) && picks < TOP_PICKS;
    if (pick) picks += 1;
    return { ...candidate, section: pick ? "top" : candidate.home };
  });
  // Built-in sections keep their fixed order. A custom section follows them, in order of its best
  // story, so the digest reads the same whatever order the topics were added in.
  const best = new Map<string, number>();
  withSection.forEach((entry, index) => {
    if (!best.has(entry.section)) best.set(entry.section, index);
  });
  const order = (section: string): number =>
    isBuiltinSection(section)
      ? SECTIONS.indexOf(section)
      : SECTIONS.length + (best.get(section) ?? 0);
  return withSection.sort((a, b) => {
    if (a.section !== b.section) return order(a.section) - order(b.section);
    return compareCandidates(a, b);
  });
}

/**
 * The stories of sections with an allowance of their own: up to TECH_ALLOWANCE per section, taken
 * in rank order, and never more than `room` in all so the digest stays under its hard maximum.
 * Each section is its own pool, so none borrows from or lends to the main cap or another section.
 */
export function takeOwnSections(
  own: readonly Candidate[],
  room: number,
): { chosen: Candidate[]; over: Candidate[] } {
  const perSection = new Map<string, number>();
  const chosen: Candidate[] = [];
  const over: Candidate[] = [];
  for (const candidate of own) {
    const count = perSection.get(candidate.home) ?? 0;
    if (count < TECH_ALLOWANCE && chosen.length < room) {
      chosen.push(candidate);
      perSection.set(candidate.home, count + 1);
    } else {
      over.push(candidate);
    }
  }
  return { chosen, over };
}

export type Eligibility =
  | { eligible: true; candidate: Candidate }
  | { eligible: false; reason: DropReason };

/** Whether a scored item may publish at all, before the cap and section targets apply. */
export function eligibility(
  scored: ScoredItem,
  threshold: number = DEFAULT_SCORE_THRESHOLD,
): Eligibility {
  if (scored.topic) {
    // A custom topic won: it names the category, the section and whether the story may publish.
    const { topic } = scored;
    if (topic.never_publish) return { eligible: false, reason: "never_publish" };
    if (scored.score < threshold) return { eligible: false, reason: "below_threshold" };
    const home = scored.item.source_type === "youtube" ? "watch" : topic.section_id;
    return {
      eligible: true,
      candidate: { item: scored.item, category: topic.id, home, score: scored.score },
    };
  }
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
 *  6. Sections with an allowance of their own (Tech releases, and each section a custom topic
 *     defines): take the best of each by rank up to its allowance of 5, on top of the cap. The
 *     per-section target does not apply, and these pools never borrow from or lend to the cap.
 *  7. Fewer than `floor` chosen across both pools means nothing publishes.
 *  8. Assign sections: the three highest scores outside those sections become Top picks.
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
  const main = ranked.filter((candidate) => !hasOwnSection(candidate));
  const own = ranked.filter(hasOwnSection);

  const chosen = new Set<Candidate>();
  const perSection = new Map<string, number>();
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
    // A custom topic has no preference weight, so it never fills the off-taste slot.
    const reserve = main.find(
      (c) =>
        input.weights !== undefined &&
        isBuiltinCategory(c.category) &&
        input.weights[c.category] < median,
    );
    if (reserve && !chosen.has(reserve)) {
      if (chosen.size >= limit) {
        const lowest = [...chosen].sort(compareCandidates).pop();
        if (lowest) chosen.delete(lowest);
      }
      chosen.add(reserve);
    }
  }

  const ownTaken = takeOwnSections(own, VOICE_LIMITS.items.hardMax - chosen.size);
  const chosenTech = ownTaken.chosen;
  if (chosen.size + chosenTech.length < input.floor) {
    return { outcome: "nothing", selected: [], dropped, qualifying: ranked.length };
  }

  for (const candidate of main) {
    if (!chosen.has(candidate)) {
      dropped.push({ id: candidate.item.id, reason: "over_cap", score: candidate.score });
    }
  }
  for (const candidate of ownTaken.over) {
    dropped.push({
      id: candidate.item.id,
      reason: isTech(candidate) ? "over_tech_cap" : "over_section_cap",
      score: candidate.score,
    });
  }
  return {
    outcome: "selected",
    selected: assignSections([...chosen, ...chosenTech]),
    dropped,
    qualifying: ranked.length,
  };
}
