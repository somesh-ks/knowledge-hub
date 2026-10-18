import { VOICE_LIMITS } from "@dispatch/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import type { LlmClient } from "../llm/types.js";
import { newBoundary } from "../llm/untrusted.js";
import type { Taste } from "../profile/tasteNote.js";
import type { VoiceField } from "../voice/lint.js";
import type { VoiceConfig } from "../voice/voice.js";
import {
  rewriteSystemPrompt,
  rewriteUserMessage,
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
/** Low temperature keeps summaries close to the source. */
export const WRITER_TEMPERATURE = 0.2;
const WRITER_CONCURRENCY = 4;
/**
 * Output allowance per written item and per rewritten field. A headline plus an 80-word summary
 * is about 180 tokens as JSON, and the spoken telling adds about 130 more. Both leave room for a
 * reply that runs long before the linter sees it; a reply cut off mid-object would fail its batch.
 */
const WRITE_TOKENS_PER_ITEM = 800;
const WRITE_TOKENS_OVERHEAD = 300;
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
 * bar's one line: the bar then shows the headline, as for a story written before chapters.
 */
export function chapterLabel(raw: string): string | null {
  const text = cleanField("headline", raw).replace(/:$/, "");
  const words = text.split(" ").filter(Boolean).length;
  const fits = text.length <= VOICE_LIMITS.chapterChars + 4;
  return words >= 1 && words <= VOICE_LIMITS.chapterWords && fits ? text : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface NebiusWriterOptions {
  llm: LlmClient;
  voice: VoiceConfig;
  log?: Logger;
  secrets?: readonly string[];
}

/**
 * Writer over a Nebius model. Source text is wrapped in random per-request boundary markers and
 * the model is told it is data to summarize, never instructions. Output is schema-validated by
 * the client; facts come from the source text only.
 */
export class NebiusWriter implements Writer {
  private readonly options: NebiusWriterOptions;

  constructor(options: NebiusWriterOptions) {
    this.options = options;
  }

  async write(
    items: readonly SourceMaterial[],
    feedback?: string,
    taste?: Taste,
  ): Promise<WriteResult> {
    const results = await mapConcurrent(
      chunk(items, WRITER_BATCH_SIZE),
      WRITER_CONCURRENCY,
      (batch) =>
        this.writeBatch(
          batch,
          feedback,
          taste,
          items.filter((item) => !batch.includes(item)).map((item) => item.title),
        ),
    );
    return {
      written: results.flatMap((r) => r.written),
      failed: results.flatMap((r) => r.failed),
    };
  }

  private async writeBatch(
    batch: readonly SourceMaterial[],
    feedback?: string,
    taste?: Taste,
    others: readonly string[] = [],
  ): Promise<WriteResult> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: WriterOutput,
        schemaName: "dispatch_items",
        messages: [
          { role: "system", content: writerSystemPrompt(this.options.voice, boundary) },
          { role: "user", content: writerUserMessage(batch, boundary, feedback, taste, others) },
        ],
        temperature: WRITER_TEMPERATURE,
        maxTokens: WRITE_TOKENS_PER_ITEM * batch.length + WRITE_TOKENS_OVERHEAD,
        label: "writer",
      });
      const wanted = new Set(batch.map((m) => m.id));
      const seen = new Map<string, WrittenItem>();
      for (const row of value.items) {
        if (!wanted.has(row.id) || seen.has(row.id)) continue;
        const spoken = row.spoken ? cleanField("spoken", row.spoken) : "";
        const chapter = row.chapter ? chapterLabel(row.chapter) : null;
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
      this.options.log?.warn("The writer failed on a batch", { items: batch.length, reason });
      return { written: [], failed: batch.map((m) => ({ id: m.id, reason })) };
    }
  }

  async rewrite(request: RewriteRequest): Promise<string | null> {
    const boundary = newBoundary();
    try {
      const { value } = await this.options.llm.completeJson({
        schema: RewriteOutput,
        schemaName: "dispatch_rewrite",
        messages: [
          { role: "system", content: rewriteSystemPrompt(this.options.voice, boundary) },
          { role: "user", content: rewriteUserMessage(request, boundary) },
        ],
        temperature: WRITER_TEMPERATURE,
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
