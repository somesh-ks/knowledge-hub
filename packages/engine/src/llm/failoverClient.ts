import type { Logger } from "../context.js";
import { errorStatus } from "./errors.js";
import type { JsonRequest, JsonResult, LlmClient } from "./types.js";

/** Nebius answers 404 (or 400 with a message) when a model id was retired or renamed. */
export function isModelNotFound(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 404) return true;
  if (status !== 400 && status !== 422) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    /model/.test(message) &&
    /(not found|does not exist|unknown|not available|deprecated)/.test(message)
  );
}

/**
 * Uses the first model until it fails, then moves down the list for the rest of the run. A model
 * is skipped when it reports model-not-found; the first one, when `firstIsTentative` (a model the
 * owner picked in Settings), is also skipped on any other error, so a pick that misbehaves never
 * breaks a briefing: the run falls through to the environment models. Model ids are pinned and
 * Nebius retires ids, so this keeps a run alive.
 */
export function withModelChain(
  clients: readonly LlmClient[],
  log?: Logger,
  options: { firstIsTentative?: boolean } = {},
): LlmClient {
  const first = clients[0];
  if (first === undefined) throw new Error("withModelChain needs at least one client");
  let active = 0;
  const canSkip = (index: number, error: unknown): boolean =>
    index < clients.length - 1 &&
    (isModelNotFound(error) || (index === 0 && options.firstIsTentative === true));
  return {
    get model(): string {
      return (clients[active] ?? first).model;
    },
    async completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
      // Several requests can be in flight when a model fails. Each decides from the client it
      // actually used, so the ones that lose the race still move on instead of failing.
      let index = active;
      for (;;) {
        const used = clients[index] ?? first;
        try {
          return await used.completeJson(request);
        } catch (error) {
          if (!canSkip(index, error)) throw error;
          const next = clients[index + 1] as LlmClient;
          if (active === index) {
            log?.warn("A model failed; switching to the next one", {
              from: used.model,
              to: next.model,
            });
            active = index + 1;
          }
          index += 1;
        }
      }
    },
  };
}

/** Two models: the primary until it reports model-not-found, then the fallback. */
export function withModelFailover(
  primary: LlmClient,
  fallback: LlmClient | null,
  log?: Logger,
): LlmClient {
  return withModelChain(fallback ? [primary, fallback] : [primary], log);
}
