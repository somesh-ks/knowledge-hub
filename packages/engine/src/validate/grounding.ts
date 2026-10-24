import { noul } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { Logger } from "../context.js";
import { DEFAULT_JEV_MODEL, type JevClientLike } from "../judge/jev.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { describeError } from "../llm/errors.js";
import { type RetryOptions, withRetry } from "../llm/retry.js";
import { splitSentences } from "../voice/sentences.js";
import { bestExcerpt } from "./excerpt.js";

export type GroundedField = "summary" | "why";

export interface GroundingTarget {
  id: string;
  summary: string;
  /** Checked only when the item has one. */
  why?: string | undefined;
  /** Extracted source text. Untrusted. */
  sourceText: string;
  /**
   * The source's title and outlet, which the writer reads above the text (write/prompt.ts). An
   * extracted body rarely repeats its headline, so a sentence naming the product or outlet from
   * the title read as an added name. Untrusted, like the text.
   */
  heading?: string | undefined;
}

export interface SentenceVerdict {
  field: GroundedField;
  sentence: string;
  /** Probability that the excerpt supports the sentence. Null when the check failed. */
  score: number | null;
  status: "supported" | "unsupported" | "error";
  /** Why a check failed, when it did. */
  error?: string;
}

export interface GroundingVerdict {
  id: string;
  sentences: SentenceVerdict[];
}

/** Checks that each summary sentence, and each why sentence when there is one, is supported by the source text. */
export interface Grounder {
  /** Probability at or above which a sentence counts as supported. */
  readonly threshold: number;
  ground(target: GroundingTarget): Promise<GroundingVerdict>;
}

/** The sentences of an item that grounding checks: summary, then why when the item has one. */
export function groundedSentences(target: Pick<GroundingTarget, "summary" | "why">): Array<{
  field: GroundedField;
  sentence: string;
}> {
  return [
    ...splitSentences(target.summary).map((sentence) => ({ field: "summary" as const, sentence })),
    ...splitSentences(target.why ?? "").map((sentence) => ({ field: "why" as const, sentence })),
  ];
}

/**
 * The Noul asked per sentence. Jev reads literally, so the condition is stated exactly and the
 * data sits in named state fields the question points to with backticks.
 */
export const GROUNDING_QUESTION = noul("The `source_excerpt` directly supports the `sentence`.", {
  true: "Every claim in the sentence is stated, or directly implied, by the excerpt.",
  false:
    "The sentence adds a claim, number or name that the excerpt does not state, or contradicts it.",
});

const NoulReply = z.object({
  answers: z.object({ supported: z.object({ type: z.literal("noul"), noul: z.number() }) }),
});

/** Default threshold; tuned on the golden set with `npx tsx packages/engine/eval/run.ts`. */
export const DEFAULT_GROUNDING_THRESHOLD = 0.5;

export interface JevGrounderOptions {
  client: JevClientLike;
  model?: string;
  threshold?: number;
  concurrency?: number;
  retry?: Partial<RetryOptions>;
  log?: Logger;
  secrets?: readonly string[];
}

/** Grounder over Jev: one Noul per sentence, over the sentence and its best-matching source excerpt. */
export class JevGrounder implements Grounder {
  readonly threshold: number;
  private readonly options: JevGrounderOptions;

  constructor(options: JevGrounderOptions) {
    this.options = options;
    this.threshold = options.threshold ?? DEFAULT_GROUNDING_THRESHOLD;
  }

  async ground(target: GroundingTarget): Promise<GroundingVerdict> {
    const sentences = groundedSentences(target);
    const sentenceVerdicts = await mapConcurrent(sentences, this.options.concurrency ?? 8, (s) =>
      this.checkSentence(s.field, s.sentence, target.sourceText, target.heading),
    );
    return { id: target.id, sentences: sentenceVerdicts };
  }

  private async checkSentence(
    field: GroundedField,
    sentence: string,
    sourceText: string,
    heading: string | undefined,
  ): Promise<SentenceVerdict> {
    const best = bestExcerpt(sourceText, sentence).text;
    const excerpt = heading ? `${heading}\n\n${best}` : best;
    try {
      const raw = await withRetry(
        () =>
          this.options.client.systemOne({
            state: { sentence, source_excerpt: excerpt },
            questions: { supported: GROUNDING_QUESTION },
            model: this.options.model ?? DEFAULT_JEV_MODEL,
          }),
        this.options.retry,
      );
      const reply = NoulReply.parse(raw);
      const score = reply.answers.supported.noul;
      return {
        field,
        sentence,
        score,
        status: score >= this.threshold ? "supported" : "unsupported",
      };
    } catch (error) {
      const message = describeError(error, this.options.secrets);
      this.options.log?.warn("A grounding check failed", { field, reason: message });
      return { field, sentence, score: null, status: "error", error: message };
    }
  }
}
