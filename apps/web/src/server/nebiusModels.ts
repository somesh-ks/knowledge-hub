import { listModels } from "@dispatch/core";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";

/**
 * GET /api/models: the Nebius text models the key can call, for the Model picker in Settings. The
 * list is the same one `dispatch models` prints, parsed and filtered by the shared core code. The
 * CDN holds the answer for an hour, so Nebius is asked about once an hour at most. Neither the key
 * nor anything Nebius says reaches the response or a log line.
 */

export interface ModelsEnv {
  NEBIUS_API_KEY?: string;
  NEBIUS_BASE_URL?: string;
}

export interface ModelsDeps {
  env: ModelsEnv;
  fetch: FetchLike;
  log?: (message: string) => void;
}

export type ModelsBody =
  | { provider: "nebius"; models: { id: string; context_length: number | null }[] }
  | { error: "unavailable" };

/** Same default as core's env. */
export const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";
export const MODELS_TIMEOUT_MS = 8000;
export const MODELS_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

const unavailable: ApiResult<ModelsBody> = {
  status: 503,
  headers: { "Cache-Control": "no-store" },
  body: { error: "unavailable" },
};

function modelsUrl(base: string | undefined): string | null {
  const root = base?.trim() || DEFAULT_NEBIUS_BASE_URL;
  try {
    const url = new URL(root.endsWith("/") ? root : `${root}/`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.href}models?verbose=true`;
  } catch {
    return null;
  }
}

export async function handleModels(deps: ModelsDeps): Promise<ApiResult<ModelsBody>> {
  const key = deps.env.NEBIUS_API_KEY?.trim();
  const url = modelsUrl(deps.env.NEBIUS_BASE_URL);
  if (!key || url === null) return unavailable;
  try {
    const response = await deps.fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      deps.log?.(`Nebius answered HTTP ${response.status} for the model list`);
      return unavailable;
    }
    const models = listModels(await response.json(), false);
    return {
      status: 200,
      headers: { "Cache-Control": MODELS_CACHE_CONTROL },
      body: { provider: "nebius", models },
    };
  } catch (error) {
    // Only the kind of failure is logged: an upstream message could carry the request details.
    deps.log?.(
      `The model list could not be read (${error instanceof Error ? error.name : "error"})`,
    );
    return unavailable;
  }
}
