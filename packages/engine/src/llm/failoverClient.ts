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
 * Uses the primary model until it reports model-not-found, then switches to the fallback for the
 * rest of the run. Model ids are pinned, and Nebius retires ids, so this keeps a run alive.
 */
export function withModelFailover(
  primary: LlmClient,
  fallback: LlmClient | null,
  log?: Logger,
): LlmClient {
  let active: LlmClient = primary;
  return {
    get model(): string {
      return active.model;
    },
    async completeJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
      // Several requests can be in flight when the primary fails. Each decides from the client it
      // actually used, so the ones that lose the race still switch instead of failing.
      const used = active;
      try {
        return await used.completeJson(request);
      } catch (error) {
        if (used === primary && fallback && isModelNotFound(error)) {
          if (active === primary) {
            log?.warn("Primary model was not found; switching to the fallback model", {
              primary: primary.model,
              fallback: fallback.model,
            });
            active = fallback;
          }
          return fallback.completeJson(request);
        }
        throw error;
      }
    },
  };
}
