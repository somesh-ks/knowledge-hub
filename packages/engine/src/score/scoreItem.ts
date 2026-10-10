import {
  CATEGORIES,
  type CategoryOrNone,
  type Item,
  type JudgmentEntry,
  type Preferences,
  TECH_CATEGORY,
} from "@dispatch/core";
import { clamp01, round4 } from "./numbers.js";
import type { ScoreBreakdown, ScoredItem } from "./types.js";

/**
 * Score model, all in code so weights and thresholds can change without new judge calls.
 *
 *   score = clamp01( taste x depthFactor x penaltyFactor + bonus )
 *
 * taste         = sum over the eleven categories of P(category) x preferences.weights[category].
 *                 Probability mass on "none" contributes 0, so unplaceable items sink on their own.
 * depthFactor   = floor + (1 - floor) x (1 - (1 - depth)^2), depth in 0..1.
 *                 A concave ease-out, read from one of two answers:
 *
 *                 Craft (every category but consumer tech): depth is craft_depth and the floor is
 *                 CRAFT_FLOOR. An announcement (depth 0) keeps 55 percent of its taste, a prose
 *                 explanation (0.5) keeps about 89 percent, and mechanism shown with code or
 *                 measurements (1) keeps all of it. Technique is rewarded early, and the last
 *                 step of depth adds less than the first, so a good overview is not buried.
 *
 *                 Tech (the most probable category is consumer_tech_releases): depth is
 *                 launch_scale and the floor is TECH_FLOOR. A launch shows no technique, so craft
 *                 depth would hold every one at the floor; the size of the release ranks them
 *                 instead. At the shipped weight of 0.8 with a confident judge: level 0 (rumour,
 *                 deal, accessory) scores 0.8 x 0.35 = 0.28 and drops under the 0.4 threshold;
 *                 level 1 (routine refresh) about 0.51; level 2 (new product with a price or a
 *                 date) about 0.67; level 3 (flagship or major platform release) about 0.77; and
 *                 level 4 keeps the full 0.8. An entry judged before the question existed has no
 *                 launch_scale and counts as level 0.
 * penaltyFactor = (1 - 0.6 hype) x (1 - 0.5 sponsored) x (1 - 0.4 funding), each flag a
 *                 probability. Hype hurts most (it signals no content), sponsorship next, and
 *                 funding least because the venture category weight already discounts it.
 * bonus         = 0.03 for a preferred author plus 0.02 for a preferred keyword, so at most 0.05.
 *                 A nudge between near-ties, never enough to rescue an off-taste item.
 *
 * After custom topics, the run adds a source adjustment of at most 0.03 either way from the
 * source's 30-day pass rate (score/sourceAdjust.ts). It is not part of this function.
 */
export const CRAFT_FLOOR = 0.55;
/** Lower than the craft floor, so a tech item with nothing to launch cannot reach the threshold. */
export const TECH_FLOOR = 0.35;
export const FLAG_PENALTY = { hype: 0.6, sponsored: 0.5, funding: 0.4 } as const;
export const BONUS = { author: 0.03, keyword: 0.02, max: 0.05 } as const;

function depthFactor(depth: number, floor: number): number {
  const d = clamp01(depth);
  return floor + (1 - floor) * (1 - (1 - d) ** 2);
}

export function craftFactor(depth: number): number {
  return depthFactor(depth, CRAFT_FLOOR);
}

/** The same curve over launch scale, from the lower tech floor. */
export function launchFactor(scale: number): number {
  return depthFactor(scale, TECH_FLOOR);
}

export function penaltyFactor(flags: JudgmentEntry["flags"]): number {
  return (
    (1 - FLAG_PENALTY.hype * clamp01(flags.hype)) *
    (1 - FLAG_PENALTY.sponsored * clamp01(flags.sponsored)) *
    (1 - FLAG_PENALTY.funding * clamp01(flags.funding))
  );
}

export function taste(
  probs: JudgmentEntry["category_probs"],
  weights: Preferences["weights"],
): number {
  let sum = 0;
  for (const category of CATEGORIES) sum += (probs[category] ?? 0) * weights[category];
  return sum;
}

/** Most probable of the twelve options. Ties go to the earlier category, and "none" loses ties. */
export function topCategory(probs: JudgmentEntry["category_probs"]): CategoryOrNone {
  let best: CategoryOrNone = "none";
  let bestProb = probs.none ?? 0;
  for (const category of CATEGORIES) {
    const p = probs[category] ?? 0;
    if (p > bestProb || (p === bestProb && best === "none" && p > 0)) {
      best = category;
      bestProb = p;
    }
  }
  return best;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lowercase words only: "@Emil_Kowalski" and "emil kowalski" compare equal. */
function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const MIN_NAME_LENGTH = 3;

function hasPreferredAuthor(item: Item, preferred: readonly string[]): boolean {
  const fields = [item.author, item.source_id]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ` ${normalizeName(value)} `);
  return preferred.some((name) => {
    const needle = normalizeName(name);
    return (
      needle.length >= MIN_NAME_LENGTH && fields.some((field) => field.includes(` ${needle} `))
    );
  });
}

function hasPreferredKeyword(item: Item, keywords: readonly string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((keyword) => {
    const needle = keyword.trim().toLowerCase();
    if (needle.length === 0) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, "u").test(
      haystack,
    );
  });
}

export function preferenceBonus(item: Item, preferences: Preferences): number {
  let bonus = 0;
  if (hasPreferredAuthor(item, preferences.preferred_authors)) bonus += BONUS.author;
  if (hasPreferredKeyword(item, preferences.preferred_keywords)) bonus += BONUS.keyword;
  return Math.min(BONUS.max, bonus);
}

/** Score one judged item. Pure and deterministic. */
export function scoreItem(entry: JudgmentEntry, preferences: Preferences, item: Item): ScoredItem {
  const top = topCategory(entry.category_probs);
  const depth =
    top === TECH_CATEGORY ? launchFactor(entry.launch_scale ?? 0) : craftFactor(entry.craft_depth);
  const breakdown: ScoreBreakdown = {
    taste: round4(taste(entry.category_probs, preferences.weights)),
    craftFactor: round4(depth),
    penaltyFactor: round4(penaltyFactor(entry.flags)),
    bonus: preferenceBonus(item, preferences),
  };
  const score = round4(
    clamp01(breakdown.taste * breakdown.craftFactor * breakdown.penaltyFactor + breakdown.bonus),
  );
  return { item, entry, score, topCategory: top, breakdown };
}
