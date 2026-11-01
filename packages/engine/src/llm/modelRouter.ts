import type { ChainEntry, Env, ModelFamily, ModelRouting, ModelStep } from "@singularity/core";
import type { Logger } from "../context.js";
import { type BatchApi, createAnthropicBatchApi } from "./anthropicBatch.js";
import { runBatch } from "./batchRunner.js";
import { BudgetExceededError, DeadlineExceededError, errorStatus } from "./errors.js";
import { createJsonLlm, jsonPrompt, jsonSchemaOf } from "./jsonLlm.js";
import type { ResolvedFamilies } from "./modelResolver.js";
import { parseModelJson } from "./parseModelJson.js";
import {
  createAnthropicApi,
  createGeminiApi,
  type ModelApi,
  THINKING_HEADROOM,
} from "./providers.js";
import type { RetryOptions } from "./retry.js";
import { estimateTokens, estimateTokensForChars, type TokenBudget } from "./tokenBudget.js";
import type { BatchLlm, JsonRequest, JsonResult, LlmClient } from "./types.js";

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
    /** True for tokens billed at the Message Batches price. */
    batch?: boolean;
  }) => void;
  /** Replaces the Message Batches client, for tests. */
  batchApi?: BatchApi;
  /** Pause and clock of the batch wait, for tests. */
  batchTiming?: { now?: () => number; sleep?: (ms: number) => Promise<void>; pollMs?: number };
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
  /**
   * A BatchLlm for a step: its requests go to the Message Batches API when the step's first model is
   * Claude, and come back empty (so the caller writes them the usual way) when it is not.
   */
  batchFor(step: ModelStep): BatchLlm;
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
        // The next model that will actually be tried: resolved, and its provider has a key.
        const next = chain.slice(chain.indexOf(entry) + 1).find((e) => {
          const provider = providerOf(e.family);
          return e.family !== "jev" && resolved[e.family] && provider && apiFor(provider);
        });
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

  function batchFor(step: ModelStep): BatchLlm {
    return {
      async completeJsonBatch<T>(
        entries: ReadonlyArray<{ id: string; request: JsonRequest<T> }>,
        batchOptions: { until: number },
      ): Promise<Map<string, JsonResult<T>>> {
        const done = new Map<string, JsonResult<T>>();
        await ensureReady();
        const entry = (routing.steps[step]?.chain ?? []).find((e) => e.family !== "jev");
        const model = entry ? resolved[entry.family]?.id : undefined;
        const key = env.ANTHROPIC_API_KEY;
        if (!entry || !model || providerOf(entry.family) !== "anthropic" || !key) return done;
        const api =
          options.batchApi ??
          createAnthropicBatchApi({
            apiKey: key,
            fetch: options.fetch,
            onRequest: () => options.onRequest?.("anthropic"),
          });
        const prepared = entries.map(({ id, request }, index) => {
          const { system, messages } = jsonPrompt(request);
          const asked = request.maxTokens ?? 1_500;
          const maxTokens = entry.max_tokens ? Math.min(asked, entry.max_tokens) : asked;
          return {
            id,
            request,
            customId: `w${index}`,
            maxTokens,
            system,
            messages,
          };
        });
        // The guard counts what the batch could spend before it is submitted: one request's reply
        // allowance and prompt, summed. When the whole does not fit the budget, nothing is
        // submitted and the writer writes live, where each request is checked on its own.
        const estimate = prepared.reduce(
          (sum, item) =>
            sum +
            estimateTokensForChars(
              item.system.length + item.messages.reduce((n, m) => n + m.content.length, 0),
            ) +
            item.maxTokens +
            THINKING_HEADROOM,
          0,
        );
        if (options.budget.remaining < estimate) {
          log.warn("The batch does not fit the token budget; writing the stories one by one", {
            estimate,
            remaining: options.budget.remaining,
          });
          return done;
        }
        const outcomes = await runBatch(
          api,
          prepared.map((item) => ({
            customId: item.customId,
            request: {
              model,
              system: item.system,
              messages: item.messages.filter(
                (m): m is { role: "user" | "assistant"; content: string } => m.role !== "system",
              ),
              maxTokens: item.maxTokens,
              effort: entry.effort,
              schema: jsonSchemaOf(item.request.schema),
              timeoutMs: entry.timeout_ms,
            },
          })),
          { until: batchOptions.until, log, ...options.batchTiming },
        );
        for (const item of prepared) {
          const outcome = outcomes.get(item.customId);
          if (outcome?.type !== "succeeded") continue;
          const { reply } = outcome;
          // Billed whether or not the reply is used.
          options.budget.record(
            reply.inputTokens + reply.outputTokens || estimateTokens(reply.text),
          );
          options.onUsage?.({
            provider: "anthropic",
            model,
            inputTokens: reply.inputTokens,
            outputTokens: reply.outputTokens,
            step,
            batch: true,
          });
          if (reply.stopReason !== "end") continue;
          try {
            const parsed = item.request.schema.safeParse(parseModelJson(reply.text));
            if (parsed.success) {
              done.set(item.id, {
                value: parsed.data,
                usage: {
                  promptTokens: reply.inputTokens,
                  completionTokens: reply.outputTokens,
                  totalTokens: reply.inputTokens + reply.outputTokens,
                },
              });
            }
          } catch {
            // An unreadable reply is written again the usual way.
          }
        }
        log.info("Writer batch finished", {
          step,
          requests: prepared.length,
          used: done.size,
        });
        return done;
      },
    };
  }

  return {
    callModel,
    batchFor,
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
