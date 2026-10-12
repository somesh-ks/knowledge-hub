import { type Env, requireKey } from "@dispatch/core";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ChatApi } from "./nebiusClient.js";

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Adapter from the official `openai` package, pointed at Nebius Token Factory, to ChatApi.
 * Retries are disabled here because withRetry owns them, so attempts are never multiplied.
 * The key comes from the typed env and is never logged.
 */
export function createOpenAiChatApi(env: Env): ChatApi {
  const client = new OpenAI({
    apiKey: requireKey(env, "NEBIUS_API_KEY"),
    baseURL: env.NEBIUS_BASE_URL,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return {
    async createChatCompletion(body, options) {
      // The body is built by nebiusClient and includes provider fields the SDK types do not list.
      // nebiusClient sizes the timeout from the reply asked for; the default covers other callers.
      return client.chat.completions.create(
        body as unknown as ChatCompletionCreateParamsNonStreaming,
        { timeout: options?.timeoutMs ?? REQUEST_TIMEOUT_MS },
      );
    },
  };
}
