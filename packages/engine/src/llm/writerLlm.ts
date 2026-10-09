import { type Env, requireKey, resolveWriterModels } from "@dispatch/core";
import type { Logger } from "../context.js";
import { loadWriterChoice } from "../writer/store.js";
import { createAnthropicLlm } from "./anthropicClient.js";
import { withModelChain } from "./failoverClient.js";
import { type ChatApi, createNebiusLlm } from "./nebiusClient.js";
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
  /** Replaces the global fetch for Anthropic calls; tests only. */
  anthropicFetch?: typeof fetch;
}

/**
 * The writer's client. It tries the model chosen in Settings (config/writer.json), then
 * DISPATCH_MODEL, then DISPATCH_FALLBACK_MODEL. A Settings model that fails for any reason, or
 * no longer exists, hands over to the next one, so a pick can never break a briefing or episode.
 * With all three empty it fails naming DISPATCH_MODEL. When Settings names an Anthropic model,
 * that model leads on the Anthropic API and the environment's Nebius models follow it.
 */
export function createWriterLlm(options: WriterLlmOptions): LlmClient {
  const { root, env, api, budget, log } = options;
  const choice = loadWriterChoice(root);
  const anthropicModel = choice?.provider === "anthropic" ? choice.model : null;
  const chosen = anthropicModel === null ? (choice?.model ?? null) : null;
  const models = resolveWriterModels(chosen, env);
  if (models.length === 0 && anthropicModel === null) requireKey(env, "DISPATCH_MODEL");
  const clients = models.map((model) => createNebiusLlm({ api, model, budget, log }));
  if (anthropicModel !== null) {
    clients.unshift(
      createAnthropicLlm({
        env,
        model: anthropicModel,
        budget,
        log,
        fetch: options.anthropicFetch,
        onRequest: options.onAnthropicRequest,
      }),
    );
  }
  const settingsLeads = anthropicModel !== null || (chosen !== null && models[0] === chosen.trim());
  return withModelChain(clients, log, { firstIsTentative: settingsLeads });
}
