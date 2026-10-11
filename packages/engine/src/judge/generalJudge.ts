import { hashOf, type Item, type Topic, type TopicJudgmentEntry } from "@dispatch/core";
import type { Questions } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { describeError } from "../llm/errors.js";
import { type RetryOptions, withRetry } from "../llm/retry.js";
import { clamp01, round4 } from "../score/numbers.js";
import { DEFAULT_JEV_CONCURRENCY, DEFAULT_JEV_MODEL, type JevClientLike } from "./jev.js";
import { FLAG_DEFINITIONS, JEV_QUESTIONS, STATE_LIMITS } from "./questions.js";
import { judgeState } from "./state.js";
import { TopicResponse, topicEntriesFromAnswers } from "./topicJudge.js";
import { buildTopicQuestions } from "./topicQuestions.js";
import type { JudgeFailure } from "./types.js";

/**
 * Bump when the flag questions or the wording around them change, so a pass file written with the
 * old wording is asked again.
 */
export const GENERAL_QUESTION_VERSION = "general-v1";

/**
 * Hash of what a general story is asked besides its topic fits: the two trust flags. The fits
 * carry their own hash per topic (topicHash). Stored in the pass's general-judged.json.
 */
export const GENERAL_QUESTIONS_HASH = hashOf({
  version: GENERAL_QUESTION_VERSION,
  hype: FLAG_DEFINITIONS.hype.instructions,
  sponsored: FLAG_DEFINITIONS.sponsored.instructions,
  state: STATE_LIMITS,
});

const noul = z.object({ type: z.literal("noul"), noul: z.number() });
const FlagAnswers = z.object({ hype: noul, sponsored: noul });

export interface GeneralRequest {
  item: Item;
  /** The general topics to ask the fit of: the item's own, and switched on. */
  topics: readonly Topic[];
}

export interface GeneralAnswer {
  item: Item;
  /** Null when Jev's reply held no usable flag answers: the story is judged but not asked. */
  flags: { hype: number; sponsored: number } | null;
  fits: TopicJudgmentEntry[];
}

export interface GeneralJudgeUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GeneralJudgeOptions {
  client: JevClientLike;
  model?: string;
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  now?: () => Date;
  log?: Logger;
  onFailure?: (failure: JudgeFailure) => void;
  secrets?: readonly string[];
}

/**
 * Judges a story of a general news feed (D66). One Jev request per story holds its general topic's
 * fit question, built from the topic's name and description like an app topic's, and the two trust
 * flag questions (hype, sponsored) the briefing's judge asks, so a feed's trust is measured. The
 * briefing's category questions are never asked: a general story cannot reach a briefing.
 */
export class GeneralJudge {
  readonly model: string;
  private readonly options: GeneralJudgeOptions;
  private readonly totals: GeneralJudgeUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  constructor(options: GeneralJudgeOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
  }

  get usage(): Readonly<GeneralJudgeUsage> {
    return this.totals;
  }

  /** Answers for the stories Jev could answer; a failed story is reported and left out. */
  async judge(requests: readonly GeneralRequest[]): Promise<GeneralAnswer[]> {
    const concurrency = this.options.concurrency ?? DEFAULT_JEV_CONCURRENCY;
    const results = await mapConcurrent([...requests], concurrency, (request) =>
      this.judgeOne(request),
    );
    return results.filter((answer): answer is GeneralAnswer => answer !== null);
  }

  private async judgeOne({ item, topics }: GeneralRequest): Promise<GeneralAnswer | null> {
    const { questions: fitQuestions, topicByKey } = buildTopicQuestions(topics);
    try {
      const raw = await withRetry(
        () =>
          this.options.client.systemOne({
            state: { ...judgeState(item) },
            questions: {
              hype: JEV_QUESTIONS.hype,
              sponsored: JEV_QUESTIONS.sponsored,
              ...fitQuestions,
            } as Questions,
            model: this.model,
          }),
        {
          ...this.options.retry,
          onRetry: (info) => {
            this.options.log?.warn("Jev request failed; retrying", {
              itemId: item.id,
              attempt: info.attempt,
              delayMs: info.delayMs,
            });
          },
        },
      );
      const parsed = TopicResponse.safeParse(raw);
      if (!parsed.success) throw new Error("Jev answered in an unexpected shape.");
      const now = (this.options.now ?? (() => new Date()))();
      const fits = topicEntriesFromAnswers({
        item,
        topics,
        topicByKey,
        answers: parsed.data.answers,
        model: this.model,
        now,
      });
      const flags = FlagAnswers.safeParse(parsed.data.answers);
      this.totals.requests += 1;
      this.totals.inputTokens += parsed.data.usage?.input_tokens ?? 0;
      this.totals.outputTokens += parsed.data.usage?.output_tokens ?? 0;
      return {
        item,
        flags: flags.success
          ? {
              hype: round4(clamp01(flags.data.hype.noul)),
              sponsored: round4(clamp01(flags.data.sponsored.noul)),
            }
          : null,
        fits,
      };
    } catch (error) {
      const reason = describeError(error, this.options.secrets);
      this.options.log?.warn("Jev could not judge a general story", { itemId: item.id, reason });
      this.options.onFailure?.({ itemId: item.id, reason });
      return null;
    }
  }
}
