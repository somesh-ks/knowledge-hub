import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Logger } from "../context.js";
import { errorStatus, LlmOutputError } from "./errors.js";
import { parseModelJson } from "./parseModelJson.js";
import { type RetryOptions, withRetry } from "./retry.js";
import { DEFAULT_THINKING_OFF, type ThinkingOff, thinkingParams } from "./thinking.js";
import { estimateTokens, estimateTokensForChars, type TokenBudget } from "./tokenBudget.js";
import type { ChatMessage, JsonRequest, JsonResult, LlmClient, LlmUsage } from "./types.js";

/** The slice of an OpenAI-compatible chat API the client uses. The real adapter is in openAiChatApi.ts. */
export interface ChatApi {
  createChatCompletion(body: Record<string, unknown>): Promise<ChatApiResponse>;
}

export interface ChatApiResponse {
  choices: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

export type ResponseMode = "json_schema" | "json_object";

export interface NebiusLlmOptions {
  api: ChatApi;
  model: string;
  budget: TokenBudget;
  /** Defaults to the documented reasoning_effort "none". */
  thinkingOff?: ThinkingOff;
  /** Starts strict; falls back to json_object for the rest of the run if the model rejects schemas. */
  responseMode?: ResponseMode;
  retry?: Partial<RetryOptions>;
  log?: Logger;
}

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1_500;
/** One corrective retry after a reply fails validation, as the plan specifies. */
const VALIDATION_RETRIES = 1;

function schemaRejected(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== 400 && status !== 422) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /response_format|json_schema|json schema|guided|structured/.test(message);
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** The JSON Schema as compact text, sent in the prompt as well as in response_format. */
function schemaText(schema: z.ZodType): string {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return JSON.stringify(rest);
}

function totalChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

/**
 * LlmClient over an OpenAI-compatible endpoint (Nebius Token Factory). Every reply is parsed
 * and re-validated with Zod; one failed validation gets a corrective retry with the error
 * appended. The spend guard checks before each request and records reported usage after it.
 */
export function createNebiusLlm(options: NebiusLlmOptions): LlmClient {
  const thinkingOff = options.thinkingOff ?? DEFAULT_THINKING_OFF;
  let mode: ResponseMode = options.responseMode ?? "json_schema";

  async function send<T>(
    request: JsonRequest<T>,
    messages: readonly ChatMessage[],
  ): Promise<{ content: string; usage: LlmUsage }> {
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    for (let pass = 0; ; pass++) {
      options.budget.check(estimateTokensForChars(totalChars(messages)) + maxTokens);
      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        temperature: request.temperature ?? DEFAULT_TEMPERATURE,
        max_tokens: maxTokens,
        response_format:
          mode === "json_schema"
            ? zodResponseFormat(request.schema, request.schemaName)
            : { type: "json_object" },
        ...thinkingParams(thinkingOff),
      };
      try {
        const response = await withRetry(() => options.api.createChatCompletion(body), {
          ...options.retry,
          onRetry: (info) => {
            options.log?.warn(`${request.label}: retrying after a transient error`, {
              attempt: info.attempt,
              delayMs: info.delayMs,
            });
          },
        });
        const message = response.choices[0]?.message;
        if (message?.refusal) throw new LlmOutputError("The model refused the request.");
        const content = message?.content ?? "";
        const prompt =
          response.usage?.prompt_tokens ?? estimateTokensForChars(totalChars(messages));
        const completion = response.usage?.completion_tokens ?? estimateTokens(content);
        const total = response.usage?.total_tokens ?? prompt + completion;
        options.budget.record(total);
        return {
          content,
          usage: { promptTokens: prompt, completionTokens: completion, totalTokens: total },
        };
      } catch (error) {
        if (mode === "json_schema" && pass === 0 && schemaRejected(error)) {
          options.log?.warn(`${request.label}: model rejected json_schema, using json_object`);
          mode = "json_object";
          continue;
        }
        throw error;
      }
    }
  }

  return {
    model: options.model,
    async completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
      const hint = `Reply with one JSON object that matches this JSON Schema, and nothing else: ${schemaText(request.schema)}`;
      const messages: ChatMessage[] = [...request.messages, { role: "user", content: hint }];
      const usage: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let lastProblem = "";
      for (let attempt = 0; attempt <= VALIDATION_RETRIES; attempt++) {
        const reply = await send(request, messages);
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
