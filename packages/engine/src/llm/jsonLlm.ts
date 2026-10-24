import type { Effort } from "@singularity/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import { DeadlineExceededError, errorStatus, LlmOutputError, ModelRefusalError } from "./errors.js";
import { parseModelJson } from "./parseModelJson.js";
import { type ModelApi, THINKING_HEADROOM } from "./providers.js";
import { type RetryOptions, withRetry } from "./retry.js";
import { estimateTokens, estimateTokensForChars, type TokenBudget } from "./tokenBudget.js";
import type { ChatMessage, JsonRequest, JsonResult, LlmClient, LlmUsage } from "./types.js";

export interface JsonLlmOptions {
  api: ModelApi;
  model: string;
  budget: TokenBudget;
  effort?: Effort | undefined;
  /** The longest one request may take. */
  timeoutMs: number;
  /** Caps the reply a caller asks for, when the routing file sets one. */
  maxTokens?: number | undefined;
  retry?: Partial<RetryOptions>;
  log?: Logger;
  /** Reported token counts of each answered request, for the cost ledger. */
  onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void;
  now?: () => number;
}

const DEFAULT_MAX_TOKENS = 1_500;
/** Retries of one request start only within this many timeouts of its first attempt. */
const RETRY_WINDOW_TIMEOUTS = 2;
/** One corrective retry after a reply fails validation. */
const VALIDATION_RETRIES = 1;

function schemaRejected(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== 400 && status !== 422) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /output_config|json_schema|json schema|schema|structured|format/.test(message);
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

const totalChars = (messages: readonly ChatMessage[]): number =>
  messages.reduce((sum, message) => sum + message.content.length, 0);

/**
 * LlmClient over one model of one provider. Every reply is parsed and re-validated with Zod; one
 * failed validation gets a corrective retry. The stop reason is read before the content: a refusal
 * throws ModelRefusalError and a cut-off reply throws LlmOutputError, so the chain moves on. The
 * spend guard checks before each request and records reported usage after it. No temperature,
 * top_p or top_k is ever sent.
 */
export function createJsonLlm(options: JsonLlmOptions): LlmClient {
  // Starts strict; a model that rejects the schema gets it in the prompt alone for the rest of the run.
  let structured = options.api.provider === "anthropic";

  async function send<T>(
    request: JsonRequest<T>,
    system: string,
    messages: ChatMessage[],
  ): Promise<{ content: string; usage: LlmUsage }> {
    const asked = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    const maxTokens = options.maxTokens ? Math.min(asked, options.maxTokens) : asked;
    const now = options.now ?? Date.now;
    const deadlineAt = Math.min(
      request.deadlineAt ?? Number.POSITIVE_INFINITY,
      now() + RETRY_WINDOW_TIMEOUTS * options.timeoutMs,
    );
    // The Anthropic request adds the thinking headroom to max_tokens, and that is billed as output.
    const requested = maxTokens + (options.api.provider === "anthropic" ? THINKING_HEADROOM : 0);
    for (;;) {
      options.budget.check(
        estimateTokensForChars(totalChars(messages) + system.length) + requested,
      );
      try {
        const reply = await withRetry(
          () => {
            const left = deadlineAt - now();
            if (left <= 0) {
              throw new DeadlineExceededError(`${request.label}: out of time before the request`);
            }
            return options.api.call({
              model: options.model,
              system,
              messages: messages.filter(
                (m): m is { role: "user" | "assistant"; content: string } => m.role !== "system",
              ),
              maxTokens,
              effort: options.effort,
              schema: structured ? jsonSchemaOf(request.schema) : null,
              timeoutMs: Math.min(options.timeoutMs, left),
            });
          },
          {
            ...options.retry,
            deadlineAt,
            now,
            onRetry: (info) => {
              options.log?.warn(`${request.label}: retrying after a transient error`, {
                attempt: info.attempt,
                delayMs: info.delayMs,
              });
            },
          },
        );
        const total = reply.inputTokens + reply.outputTokens;
        options.budget.record(total || estimateTokens(reply.text));
        options.onUsage?.({
          model: options.model,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
        });
        if (reply.stopReason === "refusal") throw new ModelRefusalError();
        if (reply.stopReason === "max_tokens") {
          throw new LlmOutputError("The reply was cut off at the token limit.");
        }
        return {
          content: reply.text,
          usage: {
            promptTokens: reply.inputTokens,
            completionTokens: reply.outputTokens,
            totalTokens: total,
          },
        };
      } catch (error) {
        if (structured && schemaRejected(error)) {
          options.log?.warn(
            `${request.label}: model rejected the response schema; asking in the prompt`,
            {
              model: options.model,
            },
          );
          structured = false;
          continue;
        }
        throw error;
      }
    }
  }

  return {
    model: options.model,
    async completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
      const hint = `Reply with one JSON object that matches this JSON Schema, and nothing else: ${JSON.stringify(jsonSchemaOf(request.schema))}`;
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const messages: ChatMessage[] = [
        ...request.messages.filter((message) => message.role !== "system"),
        { role: "user", content: hint },
      ];
      const usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let lastProblem = "";
      for (let attempt = 0; attempt <= VALIDATION_RETRIES; attempt++) {
        const reply = await send(request, system, messages);
        usage.promptTokens += reply.usage.promptTokens;
        usage.completionTokens += reply.usage.completionTokens;
        usage.totalTokens += reply.usage.totalTokens;
        try {
          const parsed = request.schema.safeParse(parseModelJson(reply.content));
          if (parsed.success) return { value: parsed.data, usage };
          lastProblem = summarizeIssues(parsed.error);
        } catch (error) {
          if (!(error instanceof LlmOutputError)) throw error;
          lastProblem = error.message;
        }
        options.log?.warn(`${request.label}: reply failed validation`, { attempt: attempt + 1 });
        messages.push(
          { role: "assistant", content: reply.content.slice(0, 4_000) },
          {
            role: "user",
            content: `Your previous reply failed validation: ${lastProblem}. Reply again with only the corrected JSON object.`,
          },
        );
      }
      throw new LlmOutputError(`The model reply failed validation after a retry: ${lastProblem}`);
    },
  };
}
