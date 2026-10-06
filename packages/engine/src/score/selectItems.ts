import {
  CATEGORIES,
  type Category,
  type DigestKind,
  homeSection,
  type Item,
  NEVER_PUBLISH,
  SECTIONS,
  type Section,
  VOICE_LIMITS,
} from "@dispatch/core";
import type { Candidate, ScoredItem, SelectedItem } from "./types.js";

/**
 * Minimum score to publish. A starting value: it is tuned on the golden set (see eval/), and
 * lives in code, never in a prompt. An off-taste item with no craft cannot reach it, while a
 * frontier-model announcement (weight 0.85, depth 0) lands just above it.
 */
export const DEFAULT_SCORE_THRESHOLD = 0.4;

/** Items taken per home section before overflow is allowed. */
export const SECTION_TARGET_MAX = 3;

/** Top picks: the highest-scoring items, moved out of their home section. */
export const TOP_PICKS = 3;

export type DropReason = "no_category" | "never_publish" | "below_threshold" | "over_cap";

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
  /** Requested cap; never raised above the hard cap for the kind (12, weekly 18). */
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

/** Hard cap on items for a digest kind. */
export function capFor(kind: DigestKind): number {
  return kind === "weekly" ? VOICE_LIMITS.items.weeklyCap : VOICE_LIMITS.items.cap;
}

/** Median of the ten preference weights (mean of the middle two). */
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
 * Final sections for a chosen set: the three highest scores become "top", the rest keep their
 * home section. Also used after later stages drop items, so top picks always stay the best three.
 */
export function assignSections(chosen: readonly Candidate[]): SelectedItem[] {
  const ranked = [...chosen].sort(compareCandidates);
  const withSection: SelectedItem[] = ranked.map((candidate, index) => ({
    ...candidate,
    section: index < TOP_PICKS ? "top" : candidate.home,
  }));
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
 *  3. Fewer than `floor` left means nothing publishes.
 *  4. Walk by rank taking at most 3 per home section up to the cap, then let overflow fill any
 *     remaining room, so a thin section never leaves slots empty.
 *  5. Weekly only: guarantee one slot for the best item whose category weight is below the
 *     median of preferences, so taste does not narrow week over week.
 *  6. Assign sections: three highest scores become Top picks.
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
  if (ranked.length < input.floor || limit < input.floor) {
    return { outcome: "nothing", selected: [], dropped, qualifying: ranked.length };
  }

  const chosen = new Set<Candidate>();
  const perSection = new Map<Section, number>();
  const take = (candidate: Candidate): void => {
    chosen.add(candidate);
    perSection.set(candidate.home, (perSection.get(candidate.home) ?? 0) + 1);
  };
  for (const candidate of ranked) {
    if (chosen.size >= limit) break;
    if ((perSection.get(candidate.home) ?? 0) < SECTION_TARGET_MAX) take(candidate);
  }
  for (const candidate of ranked) {
    if (chosen.size >= limit) break;
    if (!chosen.has(candidate)) take(candidate);
  }

  if (input.kind === "weekly" && input.weights) {
    const median = medianWeight(input.weights);
    const reserve = ranked.find((c) => input.weights && input.weights[c.category] < median);
    if (reserve && !chosen.has(reserve)) {
      if (chosen.size >= limit) {
        const lowest = [...chosen].sort(compareCandidates).pop();
        if (lowest) chosen.delete(lowest);
      }
      chosen.add(reserve);
    }
  }

  for (const candidate of ranked) {
    if (!chosen.has(candidate)) {
      dropped.push({ id: candidate.item.id, reason: "over_cap", score: candidate.score });
    }
  }
  return {
    outcome: "selected",
    selected: assignSections([...chosen]),
    dropped,
    qualifying: ranked.length,
  };
}
