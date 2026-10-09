import { type Env, requireKey, resolveWriterModels } from "@dispatch/core";
import type { Logger } from "../context.js";
import { loadWriterModel } from "../writer/store.js";
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
}

/**
 * The writer's client. It tries the model chosen in Settings (config/writer.json), then
 * DISPATCH_MODEL, then DISPATCH_FALLBACK_MODEL. A Settings model that fails for any reason, or
 * no longer exists, hands over to the next one, so a pick can never break a briefing or episode.
 * With all three empty it fails naming DISPATCH_MODEL.
 */
export function createWriterLlm(options: WriterLlmOptions): LlmClient {
  const { root, env, api, budget, log } = options;
  const chosen = loadWriterModel(root);
  const models = resolveWriterModels(chosen, env);
  if (models.length === 0) requireKey(env, "DISPATCH_MODEL");
  const clients = models.map((model) => createNebiusLlm({ api, model, budget, log }));
  const settingsLeads = chosen !== null && models[0] === chosen.trim();
  return withModelChain(clients, log, { firstIsTentative: settingsLeads });
}
