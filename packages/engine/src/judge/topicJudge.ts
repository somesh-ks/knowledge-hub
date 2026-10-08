import {
  EMPTY_TOPIC_JUDGMENTS,
  type Item,
  type Topic,
  type TopicJudgmentEntry,
  type TopicJudgmentsFile,
} from "@dispatch/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { describeError } from "../llm/errors.js";
import { type RetryOptions, withRetry } from "../llm/retry.js";
import { clamp01, round4 } from "../score/numbers.js";
import { DEFAULT_JEV_CONCURRENCY, DEFAULT_JEV_MODEL, type JevClientLike } from "./jev.js";
import { judgeState } from "./state.js";
import { buildTopicQuestions, normalizeFit, topicHash } from "./topicQuestions.js";
import type { JudgeFailure } from "./types.js";

/** Fits are pruned after 30 days, like the category judgments. */
export const TOPIC_JUDGMENT_MAX_AGE_DAYS = 30;

export function topicJudgmentKey(
  itemId: string,
  topicId: string,
  hash: string,
  model: string,
): string {
  return `${itemId}:${topicId}:${hash}:${model}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive match, so "ai" does not fire inside "maintain". */
function mentions(haystack: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, "u").test(
    haystack,
  );
}

/**
 * The cost gate. A custom topic is judged for an item only when the item names one of the topic's
 * keywords, or its source or discovery query was tagged with the topic. Everything else would be a
 * model call spent confirming that an unrelated item is unrelated.
 */
export function topicsToJudge(item: Item, topics: readonly Topic[]): Topic[] {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return topics.filter(
    (topic) =>
      item.topic_ids?.includes(topic.id) === true ||
      topic.keywords.some((keyword) => mentions(haystack, keyword)),
  );
}

const fitAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
});

/** One Jev reply for a set of topic questions: only the fit answers are read. */
const TopicResponse = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

export interface TopicJudgeUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TopicJudgeOptions {
  client: JevClientLike;
  model?: string;
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  now?: () => Date;
  log?: Logger;
  onFailure?: (failure: JudgeFailure) => void;
  secrets?: readonly string[];
}

export interface TopicRequest {
  item: Item;
  topics: readonly Topic[];
}

/** Judges items against custom topics. One Jev request per item, one question per topic inside it. */
export class TopicJudge {
  readonly model: string;
  private readonly options: TopicJudgeOptions;
  private readonly totals: TopicJudgeUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  constructor(options: TopicJudgeOptions) {
    this.options = options;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
  }

  get usage(): Readonly<TopicJudgeUsage> {
    return this.totals;
  }

  async judge(requests: readonly TopicRequest[]): Promise<TopicJudgmentEntry[]> {
    const concurrency = this.options.concurrency ?? DEFAULT_JEV_CONCURRENCY;
    const results = await mapConcurrent([...requests], concurrency, (request) =>
      this.judgeOne(request),
    );
    return results.flat();
  }

  private async judgeOne({ item, topics }: TopicRequest): Promise<TopicJudgmentEntry[]> {
    const { questions, topicByKey } = buildTopicQuestions(topics);
    try {
      const raw = await withRetry(
        () =>
          this.options.client.systemOne({
            state: { ...judgeState(item) },
            questions,
            model: this.model,
          }),
        {
          ...this.options.retry,
          onRetry: (info) => {
            this.options.log?.warn("Jev topic request failed; retrying", {
              itemId: item.id,
              attempt: info.attempt,
              delayMs: info.delayMs,
            });
          },
        },
      );
      const parsed = TopicResponse.safeParse(raw);
      if (!parsed.success) throw new Error("Jev answered in an unexpected shape.");
      const now = (this.options.now ?? (() => new Date()))().toISOString();
      const entries: TopicJudgmentEntry[] = [];
      const byId = new Map(topics.map((topic) => [topic.id, topic]));
      for (const [key, topicId] of topicByKey) {
        const answer = fitAnswer.safeParse(parsed.data.answers[key]);
        const topic = byId.get(topicId);
        // One malformed answer drops that topic for this item, not the others.
        if (!answer.success || !topic) continue;
        entries.push({
          item_id: item.id,
          topic_id: topicId,
          topic_hash: topicHash(topic),
          model: this.model,
          judged_at: now,
          fit: round4(clamp01(normalizeFit(answer.data.score))),
        });
      }
      this.totals.requests += 1;
      this.totals.inputTokens += parsed.data.usage?.input_tokens ?? 0;
      this.totals.outputTokens += parsed.data.usage?.output_tokens ?? 0;
      return entries;
    } catch (error) {
      const reason = describeError(error, this.options.secrets);
      this.options.log?.warn("Jev could not judge an item for its topics", {
        itemId: item.id,
        reason,
      });
      this.options.onFailure?.({ itemId: item.id, reason });
      return [];
    }
  }
}

/** Item id to topic id to fit, the shape scoring reads. */
export type TopicFits = Record<string, Record<string, number>>;

export interface CachedTopicResult {
  fits: TopicFits;
  cache: TopicJudgmentsFile;
  /** Item and topic pairs answered from the cache, asked fresh, and left unanswered. */
  hits: number;
  asked: number;
  unanswered: number;
  /** Items that matched the gate for at least one topic. */
  gated: number;
}

export function mergeTopicJudgments(
  cache: TopicJudgmentsFile,
  entries: readonly TopicJudgmentEntry[],
): TopicJudgmentsFile {
  const merged = { ...cache.entries };
  for (const entry of entries) {
    merged[topicJudgmentKey(entry.item_id, entry.topic_id, entry.topic_hash, entry.model)] = entry;
  }
  return { version: 1, entries: merged };
}

export function pruneTopicJudgments(
  cache: TopicJudgmentsFile,
  now: Date,
  maxAgeDays: number = TOPIC_JUDGMENT_MAX_AGE_DAYS,
): TopicJudgmentsFile {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const kept = Object.entries(cache.entries).filter(
    ([, entry]) => Date.parse(entry.judged_at) >= cutoff,
  );
  return { version: 1, entries: Object.fromEntries(kept) };
}

/**
 * Fit of every gated (item, topic) pair. Cached answers are reused; only the pairs the cache
 * lacks go to the judge, grouped by item so each item costs one request. Editing a topic changes
 * its hash, so that topic is asked again and the others keep their cached answers.
 */
export async function judgeTopicsWithCache(
  judge: Pick<TopicJudge, "model" | "judge">,
  items: readonly Item[],
  topics: readonly Topic[],
  cache: TopicJudgmentsFile = EMPTY_TOPIC_JUDGMENTS,
): Promise<CachedTopicResult> {
  const fits: TopicFits = {};
  const record = (itemId: string, topicId: string, fit: number): void => {
    const row = fits[itemId] ?? {};
    row[topicId] = fit;
    fits[itemId] = row;
  };
  const requests: TopicRequest[] = [];
  const hashes = new Map(topics.map((topic) => [topic.id, topicHash(topic)]));
  let hits = 0;
  let gated = 0;
  let pairs = 0;
  for (const item of items) {
    const matched = topicsToJudge(item, topics);
    if (matched.length === 0) continue;
    gated += 1;
    const missing: Topic[] = [];
    for (const topic of matched) {
      pairs += 1;
      const key = topicJudgmentKey(item.id, topic.id, hashes.get(topic.id) ?? "", judge.model);
      const cached = cache.entries[key];
      if (cached) {
        hits += 1;
        record(item.id, topic.id, cached.fit);
      } else {
        missing.push(topic);
      }
    }
    if (missing.length > 0) requests.push({ item, topics: missing });
  }
  const fresh = requests.length > 0 ? await judge.judge(requests) : [];
  for (const entry of fresh) record(entry.item_id, entry.topic_id, entry.fit);
  return {
    fits,
    cache: mergeTopicJudgments(cache, fresh),
    hits,
    asked: fresh.length,
    unanswered: pairs - hits - fresh.length,
    gated,
  };
}
