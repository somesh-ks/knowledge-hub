import { z } from "zod";
import { CATEGORIES, type Category, WEIGHT_STOPS } from "./categories.js";
import { FormatMix } from "./topics.js";

const weight = z.number().min(0).max(1);
/** The Normal stop: what a category the file does not list weighs. */
const NORMAL_WEIGHT = WEIGHT_STOPS.find((stop) => stop.name === "Normal")?.weight ?? 0.7;

/**
 * The weights, one per category. A category added after the file was written has no key; it reads
 * as Normal, so a copy saved before it (an old commit, the config store's seeded row) still parses
 * instead of stopping every run (D155).
 */
const Weights = z.preprocess(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const filled: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of CATEGORIES) if (!Object.hasOwn(filled, key)) filled[key] = NORMAL_WEIGHT;
    return filled;
  },
  z.object(
    Object.fromEntries(CATEGORIES.map((c) => [c, weight])) as Record<Category, typeof weight>,
  ),
);

/** Shape of config/preferences.json, kept compatible with the existing file. */
export const Preferences = z.object({
  profile: z.string(),
  focus: z.string(),
  weights: Weights,
  /** How much each source type counts, for every topic alike; a type at Normal is absent. */
  format_mix: FormatMix.optional(),
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
