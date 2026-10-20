import { z } from "zod";
import { CATEGORIES, type Category } from "./categories.js";

const weight = z.number().min(0).max(1);

/** Shape of config/preferences.json, kept compatible with the existing file. */
export const Preferences = z.object({
  profile: z.string(),
  focus: z.string(),
  weights: z.object(
    Object.fromEntries(CATEGORIES.map((c) => [c, weight])) as Record<Category, typeof weight>,
  ),
  preferred_keywords: z.array(z.string()),
  preferred_authors: z.array(z.string()),
  disliked_patterns: z.array(z.string()),
  feedback_history: z.array(
    z.object({
      date: z.string(),
      input: z.string(),
      changes: z.array(z.string()),
    }),
  ),
});
export type Preferences = z.infer<typeof Preferences>;

/** Bounds enforced by `dispatch learn --apply`: each weight moves one whole stop, at most this many per call. */
export const LEARN_LIMITS = { maxMoves: 3 } as const;
