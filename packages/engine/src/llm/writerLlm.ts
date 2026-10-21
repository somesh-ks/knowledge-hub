import { type Env, requireKey, resolveWriterModels } from "@dispatch/core";
import type { Logger } from "../context.js";
import { loadWriterChoice } from "../writer/store.js";
import { type AnthropicLlmOptions, createAnthropicLlm } from "./anthropicClient.js";
import { withModelChain } from "./failoverClient.js";
import { type ChatApi, createNebiusLlm } from "./nebiusClient.js";
import type { RetryOptions } from "./retry.js";
import type { TokenBudget } from "./tokenBudget.js";
import type { LlmClient } from "./types.js";

export interface WriterLlmOptions {
  root: string;
  env: Env;
  api: ChatApi;
  budget: TokenBudget;
  log: Logger;
  /** Counts each Anthropic request, retries included. */
  onAnthropicRequest?: () => void;
  /** The token counts of each answered Anthropic request. */
  onAnthropicUsage?: AnthropicLlmOptions["onUsage"];
  /** Replaces the global fetch for Anthropic calls; tests only. */
  anthropicFetch?: typeof fetch;
  /** Overrides the Nebius retry policy (its backoff waits); tests only. */
  retry?: Partial<RetryOptions>;
}

/**
 * The writer's client. It tries the model chosen in Settings (config/writer.json, or the default
 * writer, Claude Sonnet 5.5, without one), then DISPATCH_MODEL, then DISPATCH_FALLBACK_MODEL. A
 * Settings model that fails for any reason, or no longer exists, hands over to the next one, so a
 * pick can never break a briefing or episode. With all three empty it fails naming DISPATCH_MODEL.
 * An Anthropic model leads on the Anthropic API and the environment's Nebius models follow it;
 * without ANTHROPIC_API_KEY it is left out, and the Nebius models write.
 */
export function createWriterLlm(options: WriterLlmOptions): LlmClient {
  const { root, env, api, budget, log } = options;
  const choice = loadWriterChoice(root);
  const anthropicModel =
    choice.provider === "anthropic" && env.ANTHROPIC_API_KEY ? choice.model : null;
  if (choice.provider === "anthropic" && anthropicModel === null)
    log.warn(
      "The writer is on Anthropic but ANTHROPIC_API_KEY is not set: the Nebius models write.",
    );
  const chosen = choice.provider === "nebius" ? choice.model : null;
  const models = resolveWriterModels(chosen, env);
  if (models.length === 0 && anthropicModel === null) requireKey(env, "DISPATCH_MODEL");
  const clients = models.map((model) =>
    createNebiusLlm({ api, model, budget, log, retry: options.retry }),
  );
  if (anthropicModel !== null) {
    clients.unshift(
      createAnthropicLlm({
        env,
        model: anthropicModel,
        budget,
        log,
        fetch: options.anthropicFetch,
        onRequest: options.onAnthropicRequest,
        onUsage: options.onAnthropicUsage,
      }),
    );
  }
  const settingsLeads = anthropicModel !== null || (chosen !== null && models[0] === chosen.trim());
  return withModelChain(clients, log, { firstIsTentative: settingsLeads });
}
