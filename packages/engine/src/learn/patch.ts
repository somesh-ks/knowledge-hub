import { CATEGORIES, type Category, LEARN_LIMITS, type Preferences } from "@dispatch/core";
import { z } from "zod";

/** What the session model produces from a sentence such as "more shaders, less VC funding". */
export const PreferencesPatch = z.object({
  input: z.string().min(1).max(500),
  weight_deltas: z.partialRecord(z.enum(CATEGORIES), z.number().min(-1).max(1)).default({}),
  add_keywords: z.array(z.string().min(1).max(60)).max(10).default([]),
  remove_keywords: z.array(z.string().min(1).max(60)).max(10).default([]),
  add_authors: z.array(z.string().min(1).max(60)).max(10).default([]),
  remove_authors: z.array(z.string().min(1).max(60)).max(10).default([]),
  add_disliked: z.array(z.string().min(1).max(80)).max(10).default([]),
  remove_disliked: z.array(z.string().min(1).max(80)).max(10).default([]),
});
export type PreferencesPatch = z.infer<typeof PreferencesPatch>;

export interface PatchResult {
  next: Preferences;
  /** Human-readable change lines, also stored in feedback_history. */
  changes: string[];
  /** Notes about deltas that were clamped or scaled to stay within bounds. */
  clamped: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
/** Truncate toward zero at two decimals, so rounding can never push a total past its limit. */
const truncate2 = (n: number): number =>
  (Math.sign(n) * Math.floor(Math.abs(n) * 100 + 1e-9)) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function applyList(
  current: string[],
  add: string[],
  remove: string[],
  label: string,
  changes: string[],
): string[] {
  const norm = (s: string): string => s.trim().toLowerCase();
  const removals = new Set(remove.map(norm));
  let next = current.filter((entry) => {
    const drop = removals.has(norm(entry));
    if (drop) changes.push(`${label}: removed "${entry}"`);
    return !drop;
  });
  const have = new Set(next.map(norm));
  for (const entry of add) {
    const key = norm(entry);
    if (key === "" || have.has(key)) continue;
    next = [...next, entry.trim()];
    have.add(key);
    changes.push(`${label}: added "${entry.trim()}"`);
  }
  return next;
}

/**
 * Apply a patch within the learn limits: at most `perWeight` per category and `perCall` in total
 * (deltas are scaled down proportionally when the total is exceeded). Pure; the caller writes.
 */
export function applyPatch(
  current: Preferences,
  rawPatch: PreferencesPatch,
  date: string,
): PatchResult {
  const patch = PreferencesPatch.parse(rawPatch);
  const changes: string[] = [];
  const clamped: string[] = [];

  const deltas = new Map<Category, number>();
  for (const category of CATEGORIES) {
    const wanted = patch.weight_deltas[category];
    if (wanted === undefined || wanted === 0) continue;
    const limited = clamp(wanted, -LEARN_LIMITS.perWeight, LEARN_LIMITS.perWeight);
    if (limited !== wanted) clamped.push(`${category}: ${wanted} limited to ${limited}`);
    deltas.set(category, limited);
  }
  const total = [...deltas.values()].reduce((sum, d) => sum + Math.abs(d), 0);
  const scale = total > LEARN_LIMITS.perCall ? LEARN_LIMITS.perCall / total : 1;
  if (scale < 1) clamped.push(`total change ${round2(total)} scaled to ${LEARN_LIMITS.perCall}`);

  const weights = { ...current.weights };
  for (const [category, delta] of deltas) {
    const before = weights[category];
    const after = round2(clamp(before + truncate2(delta * scale), 0, 1));
    if (after !== before) {
      weights[category] = after;
      changes.push(`weight ${category}: ${before} to ${after}`);
    }
  }

  const next: Preferences = {
    ...current,
    weights,
    preferred_keywords: applyList(
      current.preferred_keywords,
      patch.add_keywords,
      patch.remove_keywords,
      "keyword",
      changes,
    ),
    preferred_authors: applyList(
      current.preferred_authors,
      patch.add_authors,
      patch.remove_authors,
      "author",
      changes,
    ),
    disliked_patterns: applyList(
      current.disliked_patterns,
      patch.add_disliked,
      patch.remove_disliked,
      "disliked",
      changes,
    ),
    feedback_history: current.feedback_history,
  };
  if (changes.length > 0) {
    next.feedback_history = [...current.feedback_history, { date, input: patch.input, changes }];
  }
  return { next, changes, clamped };
}
