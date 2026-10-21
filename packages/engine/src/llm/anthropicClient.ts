import { type Env, requireKey } from "@dispatch/core";
import type { Logger } from "../context.js";
import {
  type ChatApi,
  type ChatApiResponse,
  createNebiusLlm,
  requestTimeoutMs,
} from "./nebiusClient.js";
import type { TokenBudget } from "./tokenBudget.js";
import type { LlmClient } from "./types.js";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * Tokens added to each request's reply allowance for thinking. Current Claude models think by
 * default, and thinking counts against max_tokens: with the bare allowance, Claude Sonnet 5.5 spent
 * it thinking and cut the writer's JSON off mid-object.
 */
export const THINKING_HEADROOM = 8_000;

/** An HTTP failure from the Messages API. `status` and `headers` are what withRetry reads. */
class AnthropicHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  constructor(status: number, message: string, headers: Headers) {
    super(message);
    this.name = "AnthropicHttpError";
    this.status = status;
    this.headers = headers;
  }
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function failureMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { type?: string; message?: string } };
    const detail = json.error?.message ?? json.error?.type;
    if (detail) return `Anthropic ${response.status}: ${detail}`.slice(0, 400);
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `Anthropic ${response.status}`;
}

export interface AnthropicChatApiOptions {
  apiKey: string;
  fetch?: typeof fetch;
  /** Counts each request, retries included. */
  onRequest?: () => void;
  /** The token counts of each answered request, for the cost ledger. */
  onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void;
}

/**
 * The ChatApi slice the Nebius client uses, answered by the Anthropic Messages API. System
 * messages move to the `system` field; response_format and thinking fields are not sent, since
 * JSON is asked for in the prompt and validated by the caller. The key is only ever a header.
 */
export function createAnthropicChatApi(options: AnthropicChatApiOptions): ChatApi {
  const doFetch = options.fetch ?? fetch;
  return {
    async createChatCompletion(body, callOptions): Promise<ChatApiResponse> {
      const all = (body.messages as Array<{ role: string; content: string }>) ?? [];
      const system = all
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const payload: Record<string, unknown> = {
        model: body.model,
        max_tokens: Number(body.max_tokens ?? 0) + THINKING_HEADROOM,
        // No temperature: Claude Sonnet 5.5 answers 400 "temperature is deprecated for this
        // model", so every writer call fell through to the Nebius models.
        messages: all
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role, content: message.content })),
      };
      if (system) payload.system = system;
      options.onRequest?.();
      let response: Response;
      try {
        response = await doFetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(callOptions?.timeoutMs ?? REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        const wrapped = new Error(
          timedOut ? "Anthropic request timed out" : "Anthropic connection failed",
        );
        wrapped.name = timedOut ? "APITimeoutError" : "APIConnectionError";
        throw wrapped;
      }
      if (!response.ok) {
        throw new AnthropicHttpError(
          response.status,
          await failureMessage(response),
          response.headers,
        );
      }
      const json = (await response.json()) as MessagesResponse;
      const text = (json.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      const input = json.usage?.input_tokens;
      const output = json.usage?.output_tokens;
      options.onUsage?.({
        model: String(body.model ?? "unknown"),
        inputTokens: input ?? 0,
        outputTokens: output ?? 0,
      });
      return {
        choices: [{ message: { content: text } }],
        usage:
          input === undefined && output === undefined
            ? null
            : {
                prompt_tokens: input,
                completion_tokens: output,
                total_tokens: (input ?? 0) + (output ?? 0),
              },
      };
    },
  };
}

export interface AnthropicLlmOptions {
  env: Env;
  model: string;
  budget: TokenBudget;
  log?: Logger;
  fetch?: typeof fetch;
  onRequest?: () => void;
  onUsage?: AnthropicChatApiOptions["onUsage"];
}

/** LlmClient on the Anthropic Messages API, with the Nebius client's retries and validation. */
export function createAnthropicLlm(options: AnthropicLlmOptions): LlmClient {
  const api = createAnthropicChatApi({
    apiKey: requireKey(options.env, "ANTHROPIC_API_KEY"),
    fetch: options.fetch,
    onRequest: options.onRequest,
    onUsage: options.onUsage,
  });
  return createNebiusLlm({
    api,
    model: options.model,
    budget: options.budget,
    log: options.log,
    responseMode: "json_object",
    // The Messages API keeps its longer floor; a long script still gets the longer timeout.
    timeoutFor: (maxTokens) => Math.max(REQUEST_TIMEOUT_MS, requestTimeoutMs(maxTokens)),
    thinkingOff: { kind: "omit" },
  });
}
