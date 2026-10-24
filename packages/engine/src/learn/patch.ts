import {
  CATEGORIES,
  LEARN_LIMITS,
  type Preferences,
  stopIndex,
  WEIGHT_STOPS,
} from "@singularity/core";
import { z } from "zod";

/** What the session model produces from a sentence such as "more shaders, less VC funding". */
export const PreferencesPatch = z.object({
  input: z.string().min(1).max(500),
  /** Direction only: below 0 moves a weight down one stop, above 0 up one. */
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
  /** Notes about weight moves left out to stay within bounds. */
  clamped: string[];
}

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
 * Apply a patch within the learn limits: a weight moves one whole stop up or down (the sign of its
 * delta says which, its size does not matter), and at most `maxMoves` weights move per call, in
 * category order. Pure; the caller writes.
 */
export function applyPatch(
  current: Preferences,
  rawPatch: PreferencesPatch,
  date: string,
): PatchResult {
  const patch = PreferencesPatch.parse(rawPatch);
  const changes: string[] = [];
  const clamped: string[] = [];

  const weights = { ...current.weights };
  let moves = 0;
  for (const category of CATEGORIES) {
    const wanted = patch.weight_deltas[category];
    if (wanted === undefined || wanted === 0) continue;
    const before = weights[category];
    const at = stopIndex(before);
    const to = Math.min(WEIGHT_STOPS.length - 1, Math.max(0, at + Math.sign(wanted)));
    if (to === at) continue;
    if (moves >= LEARN_LIMITS.maxMoves) {
      clamped.push(`${category}: left for a later call, ${LEARN_LIMITS.maxMoves} moves per call`);
      continue;
    }
    moves += 1;
    const after = WEIGHT_STOPS[to]?.weight ?? before;
    weights[category] = after;
    changes.push(`weight ${category}: ${before} to ${after}`);
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
