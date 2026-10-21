import type { Effort } from "@dispatch/core";

/** What one provider call needs. The adapters below turn it into an Anthropic or Gemini request. */
export interface ApiRequest {
  model: string;
  system?: string;
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  /** Claude only (`output_config.effort`). Never a temperature or top_p: current Claude models answer 400. */
  effort?: Effort | undefined;
  /** JSON Schema for structured output; null asks for JSON in the prompt alone. */
  schema: Record<string, unknown> | null;
  timeoutMs: number;
}

export interface ApiReply {
  text: string;
  /** "refusal" and "max_tokens" are checked before the text is read. */
  stopReason: "end" | "refusal" | "max_tokens" | "other";
  inputTokens: number;
  outputTokens: number;
}

export interface ModelApi {
  readonly provider: "anthropic" | "gemini";
  call(request: ApiRequest): Promise<ApiReply>;
}

/** An HTTP failure from a provider. `status` and `headers` are what withRetry reads. */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  constructor(provider: string, status: number, detail: string, headers: Headers) {
    super(`${provider} ${status}${detail ? `: ${detail}` : ""}`.slice(0, 400));
    this.name = "ProviderHttpError";
    this.status = status;
    this.headers = headers;
  }
}

async function failure(provider: string, response: Response): Promise<ProviderHttpError> {
  let detail = "";
  try {
    const json = (await response.json()) as { error?: { type?: string; message?: string } };
    detail = json.error?.message ?? json.error?.type ?? "";
  } catch {
    // Not JSON: the status line is enough.
  }
  return new ProviderHttpError(provider, response.status, detail, response.headers);
}

/** A fetch that ends as a retryable timeout or connection error, named as withRetry expects. */
async function send(
  provider: string,
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const wrapped = new Error(
      timedOut ? `${provider} request timed out` : `${provider} connection failed`,
    );
    wrapped.name = timedOut ? "APITimeoutError" : "APIConnectionError";
    throw wrapped;
  }
}

export const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ANTHROPIC_VERSION = "2023-06-01";
/**
 * Tokens added to each Claude request's reply allowance for thinking. Current Claude models think
 * by default and thinking counts against max_tokens: with the bare allowance, Sonnet 5.5 spent it
 * thinking and cut the writer's JSON off mid-object.
 */
export const THINKING_HEADROOM = 8_000;

interface AnthropicBody {
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * The Anthropic Messages API (official REST; the repo carries no SDK). Sends no temperature, top_p
 * or budget_tokens (Sonnet 5.5 and Haiku 5.5 answer 400), no prefill, and no forced tool choice;
 * tuning is `output_config.effort`, structured JSON is `output_config.format`. The key is only a
 * header.
 */
export function createAnthropicApi(options: {
  apiKey: string;
  fetch?: typeof fetch;
  /** Counts each request, retries included. */
  onRequest?: () => void;
}): ModelApi {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: "anthropic",
    async call(request) {
      const outputConfig: Record<string, unknown> = {};
      if (request.effort) outputConfig.effort = request.effort;
      if (request.schema) outputConfig.format = { type: "json_schema", schema: request.schema };
      const payload: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens + THINKING_HEADROOM,
        messages: request.messages,
        ...(request.system ? { system: request.system } : {}),
        ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
      };
      options.onRequest?.();
      const response = await send(
        "Anthropic",
        doFetch,
        `${ANTHROPIC_BASE}/messages`,
        {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        request.timeoutMs,
      );
      if (!response.ok) throw await failure("Anthropic", response);
      const json = (await response.json()) as AnthropicBody;
      // The stop reason comes first: a refusal carries no usable content.
      const stopReason =
        json.stop_reason === "refusal"
          ? "refusal"
          : json.stop_reason === "max_tokens"
            ? "max_tokens"
            : json.stop_reason === "end_turn" || json.stop_reason === "stop_sequence"
              ? "end"
              : "other";
      const text = (json.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("");
      return {
        text,
        stopReason,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      };
    },
  };
}

interface GeminiBody {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

const GEMINI_REFUSALS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

/**
 * The Gemini generateContent REST endpoint. JSON comes back through `responseMimeType`; the schema
 * is in the prompt, because Gemini's schema dialect is narrower than the one Zod writes. No
 * temperature, top_p or top_k is sent. The key is only a header.
 */
export function createGeminiApi(options: {
  apiKey: string;
  fetch?: typeof fetch;
  onRequest?: () => void;
}): ModelApi {
  const doFetch = options.fetch ?? fetch;
  return {
    provider: "gemini",
    async call(request) {
      const payload = {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: request.maxTokens,
        },
      };
      options.onRequest?.();
      const response = await send(
        "Gemini",
        doFetch,
        `${GEMINI_BASE}/models/${encodeURIComponent(request.model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        request.timeoutMs,
      );
      if (!response.ok) throw await failure("Gemini", response);
      const json = (await response.json()) as GeminiBody;
      const candidate = json.candidates?.[0];
      const finish = candidate?.finishReason ?? "";
      const stopReason =
        json.promptFeedback?.blockReason || GEMINI_REFUSALS.has(finish)
          ? "refusal"
          : finish === "MAX_TOKENS"
            ? "max_tokens"
            : finish === "STOP"
              ? "end"
              : "other";
      const text = (candidate?.content?.parts ?? [])
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      const usage = json.usageMetadata;
      return {
        text,
        stopReason,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      };
    },
  };
}
