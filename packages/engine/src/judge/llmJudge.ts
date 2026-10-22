import { type CategoryOrNone, type Item, JudgmentEntry } from "@dispatch/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import type { ChatMessage, LlmClient } from "../llm/types.js";
import {
  boundaryLine,
  newBoundary,
  untrustedInstruction,
  wrapUntrusted,
} from "../llm/untrusted.js";
import { round4 } from "../score/numbers.js";
import { normalizeCraftDepth, normalizeLaunchScale } from "./jevAnswers.js";
import {
  CATEGORY_CRITERIA,
  CATEGORY_OPTIONS,
  CRAFT_LEVELS,
  CRAFT_MAX_LEVEL,
  FLAG_DEFINITIONS,
  LAUNCH_LEVELS,
  LAUNCH_MAX_LEVEL,
  LLM_QUESTIONS_HASH,
} from "./questions.js";
import { judgeState } from "./state.js";
import type { Judge, JudgeFailure } from "./types.js";

const Confidence = z.enum(["high", "medium", "low"]);
const Option = z.enum(CATEGORY_OPTIONS);

const JudgeAnswer = z.object({
  id: z.string(),
  category: Option,
  runner_up: Option,
  confidence: Confidence,
  craft_level: z.number(),
  launch_level: z.number(),
  hype: z.boolean(),
  sponsored: z.boolean(),
  funding: z.boolean(),
});

/** Reply schema of the fallback judge. Fully required fields, so strict structured output accepts it. */
export const LlmJudgeOutput = z.object({ items: z.array(JudgeAnswer) });
export type LlmJudgeAnswer = z.infer<typeof JudgeAnswer>;

/**
 * A language model cannot report calibrated probabilities, so its category answer is turned into
 * a fixed, coarse distribution. Anything built from this is lower trust than Jev's output.
 */
const SHARES: Record<z.infer<typeof Confidence>, { top: number; second: number }> = {
  high: { top: 0.85, second: 0.1 },
  medium: { top: 0.6, second: 0.25 },
  low: { top: 0.4, second: 0.3 },
};

const FLAG_YES = 0.9;
const FLAG_NO = 0.1;

export function categoryProbsFromAnswer(
  category: CategoryOrNone,
  runnerUp: CategoryOrNone,
  confidence: z.infer<typeof Confidence>,
): Record<CategoryOrNone, number> {
  const { top, second } = SHARES[confidence];
  const sameLabel = runnerUp === category;
  const others = CATEGORY_OPTIONS.filter((o) => o !== category && o !== runnerUp);
  const rest = 1 - top - second;
  const share = rest / Math.max(1, others.length);
  const probs = {} as Record<CategoryOrNone, number>;
  for (const option of CATEGORY_OPTIONS) probs[option] = round4(share);
  probs[category] = round4(sameLabel ? top + second : top);
  if (!sameLabel) probs[runnerUp] = round4(second);
  return probs;
}

export function entryFromLlmAnswer(
  answer: LlmJudgeAnswer,
  context: { model: string; questionsHash: string; now: Date },
): JudgmentEntry {
  const level = Math.min(CRAFT_MAX_LEVEL, Math.max(0, Math.round(answer.craft_level)));
  const launch = Math.min(LAUNCH_MAX_LEVEL, Math.max(0, Math.round(answer.launch_level)));
  const flag = (value: boolean): number => (value ? FLAG_YES : FLAG_NO);
  return JudgmentEntry.parse({
    item_id: answer.id,
    model: context.model,
    questions_hash: context.questionsHash,
    judged_at: context.now.toISOString(),
    category_probs: categoryProbsFromAnswer(answer.category, answer.runner_up, answer.confidence),
    craft_depth: normalizeCraftDepth(level),
    launch_scale: normalizeLaunchScale(launch),
    flags: {
      hype: flag(answer.hype),
      sponsored: flag(answer.sponsored),
      funding: flag(answer.funding),
    },
  });
}

function systemPrompt(): string {
  const categories = CATEGORY_OPTIONS.map((key) => `- ${key}: ${CATEGORY_CRITERIA[key]}`).join(
    "\n",
  );
  const levels = CRAFT_LEVELS.map((text, level) => `- ${level}: ${text}`).join("\n");
  const launches = LAUNCH_LEVELS.map((text, level) => `- ${level}: ${text}`).join("\n");
  return [
    "You classify candidate items for a private news briefing read by a design and software engineer.",
    "Judge each item from its title and snippet only.",
    "",
    "For each item answer:",
    "- category: the one best-fitting key from the list below.",
    '- runner_up: the second best key, or "none".',
    "- confidence: high, medium or low, for the category.",
    "- craft_level: an integer from 0 to 4, using the craft levels below.",
    "- launch_level: an integer from 0 to 4, using the launch levels below. Use 0 when the item is not consumer technology news.",
    `- hype: true if ${FLAG_DEFINITIONS.hype.describe}`,
    `- sponsored: true if ${FLAG_DEFINITIONS.sponsored.describe}`,
    `- funding: true if ${FLAG_DEFINITIONS.funding.describe}`,
    "",
    "Categories:",
    categories,
    "",
    "Craft levels:",
    levels,
    "",
    "Launch levels:",
    launches,
    "",
    untrustedInstruction(),
    'Reply with one JSON object: {"items":[{"id","category","runner_up","confidence","craft_level","launch_level","hype","sponsored","funding"}]}, one entry per item, keeping each id exactly.',
  ].join("\n");
}

export interface LlmJudgeOptions {
  llm: LlmClient;
  /** Items per request. Batching keeps 60 items to a dozen calls. */
  batchSize?: number;
  concurrency?: number;
  now?: () => Date;
  log?: Logger;
  onFailure?: (failure: JudgeFailure) => void;
  secrets?: readonly string[];
}

export const DEFAULT_NEBIUS_JUDGE_BATCH = 5;
const DEFAULT_NEBIUS_JUDGE_CONCURRENCY = 2;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Fallback judge: the routed Haiku or Flash-Lite model answers the same questions as strict JSON. Clearly
 * lower trust than Jev (coarse, uncalibrated probabilities), so its entries carry a `llm:`
 * model prefix and the orchestrator logs whenever it is used.
 */
export class LlmJudge implements Judge {
  readonly name = "llm";
  readonly questionsHash = LLM_QUESTIONS_HASH;
  private readonly options: LlmJudgeOptions;

  constructor(options: LlmJudgeOptions) {
    this.options = options;
  }

  get model(): string {
    return `llm:${this.options.llm.model}`;
  }

  async judge(items: Item[]): Promise<JudgmentEntry[]> {
    const batches = chunk(items, this.options.batchSize ?? DEFAULT_NEBIUS_JUDGE_BATCH);
    const results = await mapConcurrent(
      batches,
      this.options.concurrency ?? DEFAULT_NEBIUS_JUDGE_CONCURRENCY,
      (batch) => this.judgeBatch(batch),
    );
    const byId = new Map(results.flat().map((entry) => [entry.item_id, entry]));
    return items
      .map((item) => byId.get(item.id))
      .filter((e): e is JudgmentEntry => e !== undefined);
  }

  private fail(itemId: string, error: unknown): void {
    const reason = typeof error === "string" ? error : describeError(error, this.options.secrets);
    this.options.log?.warn("The fallback judge could not judge an item", { itemId, reason });
    this.options.onFailure?.({ itemId, reason });
  }

  private async judgeBatch(batch: readonly Item[]): Promise<JudgmentEntry[]> {
    const boundary = newBoundary();
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: [
          boundaryLine(boundary),
          ...batch.map((item) =>
            wrapUntrusted(JSON.stringify(judgeState(item)), boundary, `id=${item.id}`),
          ),
        ].join("\n\n"),
      },
    ];
    try {
      const { value } = await this.options.llm.completeJson({
        schema: LlmJudgeOutput,
        schemaName: "judgments",
        messages,
        maxTokens: 240 * batch.length + 200,
        label: "fallback-judge",
      });
      const wanted = new Set(batch.map((item) => item.id));
      const now = (this.options.now ?? (() => new Date()))();
      const entries = new Map<string, JudgmentEntry>();
      for (const answer of value.items) {
        if (!wanted.has(answer.id) || entries.has(answer.id)) continue;
        entries.set(
          answer.id,
          entryFromLlmAnswer(answer, {
            model: this.model,
            questionsHash: this.questionsHash,
            now,
          }),
        );
      }
      for (const item of batch) {
        if (!entries.has(item.id))
          this.fail(item.id, "The model returned no judgment for this item.");
      }
      return [...entries.values()];
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      for (const item of batch) this.fail(item.id, error);
      return [];
    }
  }
}
