import type { ChainEntry, Env, ModelFamily, ModelRouting, ModelStep } from "@dispatch/core";
import type { Logger } from "../context.js";
import { BudgetExceededError, DeadlineExceededError, errorStatus } from "./errors.js";
import { createJsonLlm } from "./jsonLlm.js";
import type { ResolvedFamilies } from "./modelResolver.js";
import { createAnthropicApi, createGeminiApi, type ModelApi } from "./providers.js";
import type { RetryOptions } from "./retry.js";
import type { TokenBudget } from "./tokenBudget.js";
import type { JsonRequest, JsonResult, LlmClient } from "./types.js";

/** Why a model failed, safe to log: status, error class and a short kind. Never the provider's message. */
export function failureReason(error: unknown): {
  status: number | null;
  error_class: string;
  kind: string;
} {
  const status = errorStatus(error) ?? null;
  const errorClass = error instanceof Error ? error.name : typeof error;
  let kind = "other";
  if (errorClass === "ModelRefusalError") kind = "refusal";
  else if (status === 401 || status === 403) kind = "authentication";
  else if (status === 404) kind = "model_not_found";
  else if (status === 429) kind = "rate_limited";
  else if (status !== null && status >= 500) kind = "server_error";
  else if (status !== null && status >= 400) kind = "rejected_request";
  else if (/timeout/i.test(errorClass)) kind = "timeout";
  else if (/connection/i.test(errorClass)) kind = "connection";
  else if (errorClass === "LlmOutputError") kind = "invalid_output";
  return { status, error_class: errorClass, kind };
}

export interface Served {
  family: ModelFamily;
  model: string;
  /** The models that failed before this one, in order, with why. */
  fellBackFrom: Array<{ family: ModelFamily; model: string; kind: string }>;
}

export interface ModelRouterOptions {
  routing: ModelRouting;
  /** Resolves the families to model ids; called once, on the first call (run start). */
  resolve: () => Promise<ResolvedFamilies>;
  env: Env;
  budget: TokenBudget;
  log: Logger;
  fetch?: typeof fetch;
  retry?: Partial<RetryOptions>;
  /** Counts each provider request, retries included. */
  onRequest?: (provider: "anthropic" | "gemini") => void;
  /** Token counts of each answered request, for the cost ledger (the product is the resolved model id). */
  onUsage?: (usage: {
    provider: "anthropic" | "gemini";
    model: string;
    inputTokens: number;
    outputTokens: number;
    step: ModelStep;
  }) => void;
  /** Called once for every move to the next model, for the run's fallback count. */
  onFallback?: (info: { step: ModelStep; from: string; to: string; kind: string }) => void;
}

export interface ModelRouter {
  /** Walks the step's chain: the next model on an error, a timeout, a refusal or invalid output. */
  callModel<T>(
    step: ModelStep,
    request: JsonRequest<T>,
  ): Promise<JsonResult<T> & { served: Served }>;
  /** An LlmClient for a step; a request's own `step` overrides it. */
  llmFor(step: ModelStep): LlmClient;
  /** The resolved ids of the step's non-Jev models, in chain order (for a step with its own caller, such as transcription). */
  modelsFor(step: ModelStep): Promise<string[]>;
  /** True when the step's chain starts with Jev, which its caller runs itself (Jev has its own SDK). */
  usesJev(step: ModelStep): boolean;
  /** The model that last served each step. */
  lastServed(): Partial<Record<ModelStep, Served>>;
}

const providerOf = (family: ModelFamily): "anthropic" | "gemini" | null =>
  family.startsWith("claude") ? "anthropic" : family.startsWith("gemini") ? "gemini" : null;

/**
 * The model orchestrator: `callModel(step, input)`. It reads the routing file's chain for the step
 * (jev is skipped here: Jev's callers use its SDK first), resolves each family to the id chosen at
 * run start, and tries them in order. Every move to the next model is a warning in the run log with
 * the reason, counted by `onFallback`; when the last model fails the error says which models
 * failed and why. The token guard's error always propagates.
 */
export function createModelRouter(options: ModelRouterOptions): ModelRouter {
  const { routing, env, log } = options;
  let resolved: ResolvedFamilies = {};
  let pending: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    pending ??= options.resolve().then((value) => {
      resolved = value;
    });
    return pending;
  };
  const apis = new Map<"anthropic" | "gemini", ModelApi | null>();
  const apiFor = (provider: "anthropic" | "gemini"): ModelApi | null => {
    if (apis.has(provider)) return apis.get(provider) ?? null;
    const key = provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
    let api: ModelApi | null = null;
    if (key) {
      const common = {
        apiKey: key,
        fetch: options.fetch,
        onRequest: () => options.onRequest?.(provider),
      };
      api = provider === "anthropic" ? createAnthropicApi(common) : createGeminiApi(common);
    } else {
      log.warn(
        `${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY"} is not set: its models are skipped in every chain`,
      );
    }
    apis.set(provider, api);
    return api;
  };

  const clients = new Map<string, LlmClient>();
  const clientFor = (step: ModelStep, entry: ChainEntry, model: string): LlmClient | null => {
    const provider = providerOf(entry.family);
    const api = provider ? apiFor(provider) : null;
    if (!provider || !api) return null;
    const key = `${step}|${entry.family}|${model}`;
    let client = clients.get(key);
    if (!client) {
      client = createJsonLlm({
        api,
        model,
        budget: options.budget,
        effort: entry.effort,
        timeoutMs: entry.timeout_ms,
        maxTokens: entry.max_tokens,
        retry: options.retry,
        log,
        onUsage: (usage) => options.onUsage?.({ provider, step, ...usage }),
      });
      clients.set(key, client);
    }
    return client;
  };

  const served: Partial<Record<ModelStep, Served>> = {};

  async function callModel<T>(
    step: ModelStep,
    request: JsonRequest<T>,
  ): Promise<JsonResult<T> & { served: Served }> {
    await ensureReady();
    const chain = routing.steps[step]?.chain ?? [];
    const failed: Served["fellBackFrom"] = [];
    let lastError: unknown;
    for (const entry of chain) {
      if (entry.family === "jev") continue;
      const model = resolved[entry.family]?.id;
      const client = model ? clientFor(step, entry, model) : null;
      if (!model || !client) continue;
      try {
        const result = await client.completeJson(request);
        const record: Served = { family: entry.family, model, fellBackFrom: failed };
        served[step] = record;
        if (failed.length > 0) {
          log.warn("Model fallback served the call", {
            step,
            served_by: model,
            failed: failed.map((f) => `${f.model} (${f.kind})`).join(", "),
          });
        }
        return { ...result, served: record };
      } catch (error) {
        if (error instanceof BudgetExceededError || error instanceof DeadlineExceededError) {
          throw error;
        }
        lastError = error;
        const reason = failureReason(error);
        failed.push({ family: entry.family, model, kind: reason.kind });
        const next = chain
          .slice(chain.indexOf(entry) + 1)
          .find((e) => e.family !== "jev" && resolved[e.family]);
        log.warn("A model failed; falling back to the next one in the chain", {
          step,
          from: model,
          to: next ? (resolved[next.family]?.id ?? null) : null,
          ...reason,
        });
        if (next) {
          options.onFallback?.({
            step,
            from: model,
            to: resolved[next.family]?.id ?? "",
            kind: reason.kind,
          });
        }
      }
    }
    const summary = failed.length
      ? failed.map((f) => `${f.model} (${f.kind})`).join(", ")
      : "no model in the chain has a key";
    const error = new Error(`Every model for the step ${step} failed: ${summary}`);
    (error as { cause?: unknown }).cause = lastError;
    error.name = lastError instanceof Error ? lastError.name : "ModelChainError";
    const status = errorStatus(lastError);
    if (status !== undefined) (error as { status?: number }).status = status;
    throw error;
  }

  return {
    callModel,
    llmFor(step) {
      return {
        get model() {
          return (
            served[step]?.model ??
            resolved[routing.steps[step]?.chain.find((e) => e.family !== "jev")?.family ?? "jev"]
              ?.id ??
            "unresolved"
          );
        },
        async completeJson(request) {
          const result = await callModel(request.step ?? step, request);
          return { value: result.value, usage: result.usage };
        },
      };
    },
    async modelsFor(step) {
      await ensureReady();
      return (routing.steps[step]?.chain ?? []).flatMap((entry) => {
        const id = entry.family === "jev" ? undefined : resolved[entry.family]?.id;
        return id ? [id] : [];
      });
    },
    usesJev: (step) => routing.steps[step]?.chain[0]?.family === "jev",
    lastServed: () => ({ ...served }),
  };
}
