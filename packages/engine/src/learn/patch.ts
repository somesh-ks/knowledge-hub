import type { Preferences } from "@singularity/core";
import { z } from "zod";

/** What the session model produces from a sentence such as "more shaders, less VC funding". */
export const PreferencesPatch = z.object({
  input: z.string().min(1).max(500),
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
 * Apply a patch: keywords, authors and disliked patterns are added and removed. Weights are gone
 * (D193); an older patch that still carries `weight_deltas` parses and the field is ignored. Pure;
 * the caller writes.
 */
export function applyPatch(
  current: Preferences,
  rawPatch: PreferencesPatch,
  date: string,
): PatchResult {
  const patch = PreferencesPatch.parse(rawPatch);
  const changes: string[] = [];

  const next: Preferences = {
    ...current,
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
  return { next, changes };
}
