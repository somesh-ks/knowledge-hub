import { z } from "zod";
import { FormatMix } from "./topics.js";

/** Shape of config/preferences.json. An older file's `weights` is stripped on parse and never read (D194). */
export const Preferences = z.object({
  profile: z.string(),
  focus: z.string(),
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
