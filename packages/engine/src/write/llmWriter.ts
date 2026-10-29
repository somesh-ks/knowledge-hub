import { VOICE_LIMITS } from "@singularity/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { BudgetExceededError, describeError, LlmOutputError } from "../llm/errors.js";
import type { LlmClient } from "../llm/types.js";
import { newBoundary } from "../llm/untrusted.js";
import type { Taste } from "../profile/tasteNote.js";
import type { VoiceField } from "../voice/lint.js";
import type { VoiceConfig } from "../voice/voice.js";
import {
  rewriteSystemPrompt,
  rewriteUserMessage,
  shortenSystemPrompt,
  shortenUserMessage,
  writerSystemPrompt,
  writerUserMessage,
} from "./prompt.js";
import type {
  RewriteRequest,
  SourceMaterial,
  WriteFailure,
  WriteResult,
  Writer,
  WrittenItem,
} from "./types.js";

/** Items per request, so one bad source cannot sink the whole run. */
export const WRITER_BATCH_SIZE = 4;
const WRITER_CONCURRENCY = 4;
/**
 * Output allowance per written item and per rewritten field. A headline plus an 80-word summary
 * is about 180 tokens as JSON, and the spoken telling adds about 130 more. Both leave room for a
 * reply that runs long before the linter sees it; a reply cut off mid-object would fail its batch.
 */
const WRITE_TOKENS_PER_ITEM = 800;
const WRITE_TOKENS_OVERHEAD = 300;
/**
 * A batch whose reply never validated (cut off at the token limit, or malformed) is written again
 * in halves, and a lone story once more, each with this much more room per item. The 2026-10-27
 * refill lost four stories to one such reply from both models, and with them the briefing's length.
 */
const RETRY_TOKEN_BOOST = 1.5;
const MAX_SPLITS = 2;
const REWRITE_MAX_TOKENS = 400;

const WriterOutput = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      headline: z.string(),
      // Nullish like spoken: without one the player bar shows the headline.
      chapter: z.string().nullish(),
      summary: z.string(),
      // Nullish so a model that skips it, or sends null, still delivers the item; narration then
      // reads the summary. The strict response format needs the key to be nullable.
      spoken: z.string().nullish(),
    }),
  ),
});

const RewriteOutput = z.object({ text: z.string() });

/**
 * Collapse whitespace and drop wrapping quotes. The writer produces no why line; the "why" case
 * serves a rewrite of one an agent session supplied, and drops a stray "Why:" label.
 */
export function cleanField(field: VoiceField, raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^["'\u201C\u2018](.*)["'\u201D\u2019]$/s, "$1").trim();
  if (field === "why") text = text.replace(/^why:\s*/i, "");
  if (field !== "summary" && field !== "spoken") text = text.replace(/\.$/, "");
  return text;
}

/**
 * The writer's chapter label, cleaned like a headline, or null when it is too long for the player
 * bar's one line, carries a dash, or states a number its headline does not: the label skips the
 * voice and grounding checks the headline passes, so it may only say less than the headline. The
 * bar then shows the headline, as for a story written before chapters.
 */
export function chapterLabel(raw: string, headline: string): string | null {
  const text = cleanField("headline", raw).replace(/:$/, "");
  if (/[\u2013\u2014]/.test(text)) return null;
  const numbers = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.some((number) => !headline.includes(number))) return null;
  const words = text.split(" ").filter(Boolean).length;
  const fits = text.length <= VOICE_LIMITS.chapterChars + 4;
  return words >= 1 && words <= VOICE_LIMITS.chapterWords && fits ? text : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface LlmWriterOptions {
  llm: LlmClient;
  voice: VoiceConfig;
  log?: Logger;
  secrets?: readonly string[];
}

/**
 * Writer over the routed story models. Source text is wrapped in random per-request boundary markers and
 * the model is told it is data to summarize, never instructions. Output is schema-validated by
 * the client; facts come from the source text only.
 */
export class LlmWriter implements Writer {
  private readonly options: LlmWriterOptions;

  constructor(options: LlmWriterOptions) {
    this.options = options;
  }

  async write(
    items: readonly SourceMaterial[],
    feedback?: string,
    taste?: Taste,
    airing: readonly string[] = [],
  ): Promise<WriteResult> {
    // A batch shares one system prompt, so stories under an owner's block prompt (D182) are
    // batched with the others of that prompt only.
    const groups = new Map<string | undefined, SourceMaterial[]>();
    for (const item of items) groups.set(item.prompt, [...(groups.get(item.prompt) ?? []), item]);
    const results = await mapConcurrent(
      [...groups.values()].flatMap((group) => chunk(group, WRITER_BATCH_SIZE)),
      WRITER_CONCURRENCY,
      (batch) =>
        this.writeBatch(batch, feedback, taste, [
          ...airing,
          ...items.filter((item) => !batch.includes(item)).map((item) => item.title),
        ]),
    );
    return {
      written: results.flatMap((r) => r.written),
      failed: results.flatMap((r) => r.failed),
    };
  }

  /**
   * Write a batch, reporting omitted items as failures and preserving batch order. `others` holds
   * titles outside this batch for context; `split` is the retry depth, starting at zero.
   * Invalid model output retries in halves (or retries a lone item) for up to two levels with a
   * larger token allowance. Other model failures become failed entries; BudgetExceededError
   * propagates without retrying.
   */
  private async writeBatch(
    batch: readonly SourceMaterial[],
    feedback?: string,
    taste?: Taste,
    others: readonly string[] = [],
    split = 0,
  ): Promise<WriteResult> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: WriterOutput,
        schemaName: "singularity_items",
        messages: [
          { role: "system", content: writerSystemPrompt(this.options.voice, batch[0]?.prompt) },
          { role: "user", content: writerUserMessage(batch, boundary, feedback, taste, others) },
        ],
        step: "story_writer",
        maxTokens: Math.round(
          (WRITE_TOKENS_PER_ITEM * batch.length + WRITE_TOKENS_OVERHEAD) *
            RETRY_TOKEN_BOOST ** split,
        ),
        label: "writer",
      });
      const wanted = new Set(batch.map((m) => m.id));
      const seen = new Map<string, WrittenItem>();
      for (const row of value.items) {
        if (!wanted.has(row.id) || seen.has(row.id)) continue;
        const spoken = row.spoken ? cleanField("spoken", row.spoken) : "";
        const chapter = row.chapter ? chapterLabel(row.chapter, row.headline) : null;
        seen.set(row.id, {
          id: row.id,
          headline: cleanField("headline", row.headline),
          ...(chapter ? { chapter } : {}),
          summary: cleanField("summary", row.summary),
          ...(spoken.length > 0 ? { spoken } : {}),
        });
      }
      const failed: WriteFailure[] = batch
        .filter((m) => !seen.has(m.id))
        .map((m) => ({ id: m.id, reason: "The model returned no entry for this item." }));
      return { written: batch.flatMap((m) => seen.get(m.id) ?? []), failed };
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      const reason = describeError(error, this.options.secrets);
      const cause = (error as { cause?: unknown }).cause;
      this.options.log?.warn("The writer failed on a batch", {
        items: batch.length,
        reason,
        ...(cause === undefined ? {} : { detail: describeError(cause, this.options.secrets) }),
        retrying: error instanceof LlmOutputError && split < MAX_SPLITS,
      });
      if (error instanceof LlmOutputError && split < MAX_SPLITS) {
        // One long or odd source can sink the reply for all four: write the halves, one after the
        // other, so a provider that is struggling is never asked for more than WRITER_CONCURRENCY.
        const parts =
          batch.length > 1
            ? [
                batch.slice(0, Math.ceil(batch.length / 2)),
                batch.slice(Math.ceil(batch.length / 2)),
              ]
            : [batch];
        const results: WriteResult[] = [];
        for (const part of parts) {
          // Each half still sees the titles of the stories outside it, the other half's included.
          const siblings = batch.filter((item) => !part.includes(item)).map((item) => item.title);
          results.push(
            await this.writeBatch(part, feedback, taste, [...others, ...siblings], split + 1),
          );
        }
        return {
          written: results.flatMap((r) => r.written),
          failed: results.flatMap((r) => r.failed),
        };
      }
      return { written: [], failed: batch.map((m) => ({ id: m.id, reason })) };
    }
  }

  async rewrite(request: RewriteRequest): Promise<string | null> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: RewriteOutput,
        schemaName: "singularity_rewrite",
        messages: request.shorten
          ? [
              { role: "system", content: shortenSystemPrompt() },
              {
                role: "user",
                content: shortenUserMessage(request.current, VOICE_LIMITS.headlineWords, boundary),
              },
            ]
          : [
              {
                role: "system",
                content: rewriteSystemPrompt(this.options.voice, request.material.prompt),
              },
              { role: "user", content: rewriteUserMessage(request, boundary) },
            ],
        step: request.shorten ? "headline_shorten" : "story_rewrite",
        maxTokens: REWRITE_MAX_TOKENS,
        label: "rewrite",
      });
      const text = cleanField(request.field, value.text);
      return text.length > 0 ? text : null;
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      this.options.log?.warn("The rewrite failed", {
        itemId: request.material.id,
        reason: describeError(error, this.options.secrets),
      });
      return null;
    }
  }
}
