import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The model families a step may use (owner decision, 2026-10-21): Jev, Gemini Flash and
 * Flash-Lite, and Claude Sonnet and Haiku. Nothing else is allowed in config/models.json: no Opus
 * (cost), no Fable, no Gemini Pro, no Nebius (removed). A new model of an allowed family is picked
 * up by the engine's resolver without a config change.
 */
export const MODEL_FAMILIES = [
  "jev",
  "claude-sonnet",
  "claude-haiku",
  "gemini-flash",
  "gemini-flash-lite",
] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export const MODEL_STEPS = [
  "judge",
  "taste_fit",
  "source_format",
  "topic_emoji",
  "grounding",
  "story_writer",
  "story_rewrite",
  "headline_shorten",
  "podcast_script",
  "podcast_opening",
  "podcast_rewrite",
  "transcription",
  "fact_extraction",
] as const;
export type ModelStep = (typeof MODEL_STEPS)[number];

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export function isModelFamily(value: string): value is ModelFamily {
  return (MODEL_FAMILIES as readonly string[]).includes(value);
}

const Family = z.enum(MODEL_FAMILIES, {
  error: `not an allowed model family (allowed: ${MODEL_FAMILIES.join(", ")}); Opus, Fable, Gemini Pro and Nebius are not used`,
});

const ChainEntry = z.object({
  family: Family,
  effort: z.enum(EFFORTS).optional(),
  max_tokens: z.number().int().positive().optional(),
  timeout_ms: z.number().int().positive().default(120_000),
});
export type ChainEntry = z.infer<typeof ChainEntry>;

const FamilyIds = z.object({
  /** Used when listing the provider's models fails. */
  fallback_id: z.string().min(1),
  /** The owner's pin: always used, the listing is not consulted. */
  pin: z.string().min(1).optional(),
});

export const ModelRouting = z.object({
  version: z.literal(1),
  families: z.partialRecord(Family, FamilyIds),
  steps: z.partialRecord(z.enum(MODEL_STEPS), z.object({ chain: z.array(ChainEntry).min(1) })),
});
export type ModelRouting = z.infer<typeof ModelRouting>;

export const MODELS_CONFIG_PATH = "config/models.json";

/** config/models.json, validated. Throws when it is missing or invalid: a run must not guess a route. */
export function loadModelRouting(root: string): ModelRouting {
  const parsed = ModelRouting.safeParse(
    JSON.parse(readFileSync(join(root, MODELS_CONFIG_PATH), "utf8")),
  );
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`${MODELS_CONFIG_PATH} is invalid: ${problems.join("; ")}`);
  }
  return parsed.data;
}
