import { type CategoryOrNone, type Item, JudgmentEntry } from "@dispatch/core";
import { z } from "zod";
import { clamp01, round4 } from "../score/numbers.js";
import { CATEGORY_OPTIONS, CRAFT_MAX_LEVEL, type FlagName } from "./questions.js";

const noulAnswer = z.object({ type: z.literal("noul"), noul: z.number() });

/** The slice of a Jev response the judge reads. Validated, so a malformed reply fails one item. */
export const JevJudgeResponse = z.object({
  model: z.string(),
  answers: z.object({
    category: z.object({
      type: z.literal("choice"),
      choice: z.string(),
      probabilities: z.record(z.string(), z.number()),
      confidence: z.number().optional(),
    }),
    craft_depth: z.object({
      type: z.literal("score"),
      score: z.number(),
      confidence: z.number().optional(),
    }),
    hype: noulAnswer,
    sponsored: noulAnswer,
    funding: noulAnswer,
  }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});
export type JevJudgeResponse = z.infer<typeof JevJudgeResponse>;

const NORMALIZE_TOLERANCE = 0.01;

/**
 * Probabilities for all eleven options, summing to 1. Unknown labels are ignored and missing
 * ones count as 0. When the reply carries no usable mass the chosen label gets everything.
 */
export function normalizeCategoryProbs(
  raw: Record<string, number>,
  chosen: string,
): Record<CategoryOrNone, number> {
  const probs = {} as Record<CategoryOrNone, number>;
  let sum = 0;
  for (const option of CATEGORY_OPTIONS) {
    const value = clamp01(raw[option] ?? 0);
    probs[option] = value;
    sum += value;
  }
  if (sum < 1e-9) {
    const fallback = (CATEGORY_OPTIONS as readonly string[]).includes(chosen)
      ? (chosen as CategoryOrNone)
      : "none";
    for (const option of CATEGORY_OPTIONS) probs[option] = option === fallback ? 1 : 0;
    return probs;
  }
  const scale = Math.abs(sum - 1) > NORMALIZE_TOLERANCE ? 1 / sum : 1;
  for (const option of CATEGORY_OPTIONS) probs[option] = round4(probs[option] * scale);
  return probs;
}

/** Expected level 0..4 to 0..1. */
export function normalizeCraftDepth(level: number): number {
  return round4(clamp01(level / CRAFT_MAX_LEVEL));
}

export interface EntryContext {
  model: string;
  questionsHash: string;
  now: Date;
}

export function entryFromJevResponse(
  item: Item,
  response: JevJudgeResponse,
  context: EntryContext,
): JudgmentEntry {
  const { answers } = response;
  const flag = (name: FlagName): number => round4(clamp01(answers[name].noul));
  return JudgmentEntry.parse({
    item_id: item.id,
    model: context.model,
    questions_hash: context.questionsHash,
    judged_at: context.now.toISOString(),
    category_probs: normalizeCategoryProbs(answers.category.probabilities, answers.category.choice),
    craft_depth: normalizeCraftDepth(answers.craft_depth.score),
    flags: { hype: flag("hype"), sponsored: flag("sponsored"), funding: flag("funding") },
  });
}
