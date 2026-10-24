import type { Item, JudgmentEntry, Topic, TopicJudgmentEntry } from "@dispatch/core";
import type { Questions } from "@typesafe-ai/sdk";
import { mapConcurrent } from "../llm/concurrency.js";
import { describeError } from "../llm/errors.js";
import { withRetry } from "../llm/retry.js";
import { DEFAULT_JEV_CONCURRENCY, DEFAULT_JEV_MODEL, type JevJudgeOptions } from "./jev.js";
import { entryFromJevResponse, JevJudgeResponse } from "./jevAnswers.js";
import { JEV_QUESTIONS, QUESTIONS_HASH } from "./questions.js";
import { judgeState } from "./state.js";
import { TopicResponse, topicEntriesFromAnswers } from "./topicJudge.js";
import { buildTopicQuestions } from "./topicQuestions.js";
import type { Judge } from "./types.js";

/** One item that needs the six main questions and at least one topic-fit question. */
export interface CombinedRequest {
  item: Item;
  topics: readonly Topic[];
}

export interface CombinedResult {
  /** Main judgments, from Jev or, when Jev could not answer, from the fallback judge. */
  entries: JudgmentEntry[];
  /** Topic fits Jev answered. */
  topicEntries: TopicJudgmentEntry[];
}

export interface CombinedJudgeOptions extends JevJudgeOptions {
  /** Answers the main questions for an item Jev could not, as the LLM fallback judge does for JevJudge. */
  fallback?: Judge | null;
}

interface OneResult {
  entry: JudgmentEntry | null;
  topicEntries: TopicJudgmentEntry[];
}

/**
 * Jev takes one item's state with a list of questions, so an item that needs both the main
 * questions and topic-fit questions costs one request, not two. The questions are the same ones
 * the two judges send on their own, so the answers, caches and hashes are the same too; only the
 * request is shared. Items that need one kind of question keep using JevJudge or TopicJudge.
 */
export class CombinedJudge {
  readonly model: string;
  private readonly options: CombinedJudgeOptions;

  constructor(options: CombinedJudgeOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
  }

  async judge(requests: readonly CombinedRequest[]): Promise<CombinedResult> {
    const concurrency = this.options.concurrency ?? DEFAULT_JEV_CONCURRENCY;
    const results = await mapConcurrent([...requests], concurrency, (request) =>
      this.judgeOne(request),
    );
    const entries: JudgmentEntry[] = [];
    const topicEntries: TopicJudgmentEntry[] = [];
    const unanswered: Item[] = [];
    for (const [index, result] of results.entries()) {
      topicEntries.push(...result.topicEntries);
      if (result.entry) entries.push(result.entry);
      else if (requests[index]) unanswered.push(requests[index].item);
    }
    if (unanswered.length > 0 && this.options.fallback) {
      this.options.log?.warn("Using the fallback judge; its probabilities are coarser than Jev's", {
        fallback: this.options.fallback.name,
        items: unanswered.length,
      });
      entries.push(...(await this.options.fallback.judge(unanswered)));
    }
    return { entries, topicEntries };
  }

  private async judgeOne({ item, topics }: CombinedRequest): Promise<OneResult> {
    const { questions: topicQuestions, topicByKey } = buildTopicQuestions(topics);
    try {
      const raw = await withRetry(
        () =>
          this.options.client.systemOne({
            state: { ...judgeState(item) },
            questions: { ...JEV_QUESTIONS, ...topicQuestions } as Questions,
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
      const now = (this.options.now ?? (() => new Date()))();
      // The two halves are read independently: a malformed half costs that half, not the other.
      const main = JevJudgeResponse.safeParse(raw);
      if (!main.success) {
        this.options.onFailure?.({
          itemId: item.id,
          reason: `Jev answered in an unexpected shape (${main.error.issues[0]?.message ?? "invalid shape"}).`,
        });
      }
      const topic = TopicResponse.safeParse(raw);
      return {
        entry: main.success
          ? entryFromJevResponse(item, main.data, {
              model: this.model,
              questionsHash: QUESTIONS_HASH,
              now,
            })
          : null,
        topicEntries: topic.success
          ? topicEntriesFromAnswers({
              item,
              topics,
              topicByKey,
              answers: topic.data.answers,
              model: this.model,
              now,
            })
          : [],
      };
    } catch (error) {
      const reason = describeError(error, this.options.secrets);
      this.options.log?.warn("Jev could not judge an item", { itemId: item.id, reason });
      this.options.onFailure?.({ itemId: item.id, reason });
      return { entry: null, topicEntries: [] };
    }
  }
}
