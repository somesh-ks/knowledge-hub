import type { Item, JudgmentEntry } from "@dispatch/core";
import type { EntryType, Questions } from "@typesafe-ai/sdk";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { describeError } from "../llm/errors.js";
import { type RetryOptions, withRetry } from "../llm/retry.js";
import { entryFromJevResponse, JevJudgeResponse } from "./jevAnswers.js";
import { JEV_QUESTIONS, QUESTIONS_HASH } from "./questions.js";
import { judgeState } from "./state.js";
import type { Judge, JudgeFailure } from "./types.js";

/** The one method of TypeSafeClient the judge uses. A fake with recorded replies implements it in tests. */
export interface JevClientLike {
  systemOne(request: {
    state: EntryType;
    questions: Questions;
    model?: string;
  }): PromiseLike<unknown>;
}

export interface JevJudgeOptions {
  client: JevClientLike;
  /** Defaults to DEFAULT_JEV_MODEL, a pinned version, so an alias moving never changes answers unseen. */
  model?: string;
  /** In-flight requests. Jev allows far more; 8 keeps one run polite. */
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  now?: () => Date;
  log?: Logger;
  onFailure?: (failure: JudgeFailure) => void;
  /** Redacted from failure text. */
  secrets?: readonly string[];
}

/**
 * Jev 1.14 (October 14, 2026), named by version: `jev-latest` still points to 1.13 and an alias
 * moves without a code change. A new version changes judgment cache keys, so items are judged afresh once.
 */
export const DEFAULT_JEV_MODEL = "jev-1.14.0";
export const DEFAULT_JEV_CONCURRENCY = 8;

export interface JevUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Judge backed by TypeSafe Jev: one request per item, six questions in parallel inside it.
 * Transient errors (429, 529, 5xx, timeouts) retry with backoff; anything else, or a reply that
 * does not validate, drops that one item and is reported. The batch itself never throws.
 */
export class JevJudge implements Judge {
  readonly name = "jev";
  readonly model: string;
  readonly questionsHash = QUESTIONS_HASH;
  private readonly options: JevJudgeOptions;
  private readonly totals: JevUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  constructor(options: JevJudgeOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
  }

  get usage(): Readonly<JevUsage> {
    return this.totals;
  }

  async judge(items: Item[]): Promise<JudgmentEntry[]> {
    const concurrency = this.options.concurrency ?? DEFAULT_JEV_CONCURRENCY;
    const results = await mapConcurrent(items, concurrency, (item) => this.judgeOne(item));
    return results.filter((entry): entry is JudgmentEntry => entry !== null);
  }

  private async judgeOne(item: Item): Promise<JudgmentEntry | null> {
    try {
      const raw = await withRetry(
        () =>
          this.options.client.systemOne({
            state: { ...judgeState(item) },
            questions: JEV_QUESTIONS,
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
      const parsed = JevJudgeResponse.safeParse(raw);
      if (!parsed.success) {
        const detail = parsed.error.issues[0]?.message ?? "invalid shape";
        throw new Error(`Jev answered in an unexpected shape (${detail}).`);
      }
      this.totals.requests += 1;
      this.totals.inputTokens += parsed.data.usage?.input_tokens ?? 0;
      this.totals.outputTokens += parsed.data.usage?.output_tokens ?? 0;
      return entryFromJevResponse(item, parsed.data, {
        model: this.model,
        questionsHash: this.questionsHash,
        now: (this.options.now ?? (() => new Date()))(),
      });
    } catch (error) {
      const reason = describeError(error, this.options.secrets);
      this.options.log?.warn("Jev could not judge an item", { itemId: item.id, reason });
      this.options.onFailure?.({ itemId: item.id, reason });
      return null;
    }
  }
}
