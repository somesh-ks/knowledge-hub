import { ANTHROPIC_MODEL_ID_PATTERN } from "@dispatch/core";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";
import { MODELS_CACHE_CONTROL, MODELS_TIMEOUT_MS } from "./nebiusModels";

/**
 * GET /api/models?provider=anthropic: the Claude models the key can call, newest first as Anthropic
 * lists them, for the Model picker in Settings. Cached at the CDN like the Nebius list, so a model
 * Anthropic releases shows within minutes. Neither the key nor anything Anthropic says reaches the
 * response or a log line.
 */

export interface AnthropicModelsEnv {
  ANTHROPIC_API_KEY?: string;
}

export type AnthropicModelsBody =
  | { provider: "anthropic"; models: { id: string; label: string }[] }
  | { error: "unavailable" };

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const ANTHROPIC_VERSION = "2023-06-01";

const unavailable: ApiResult<AnthropicModelsBody> = {
  status: 503,
  headers: { "Cache-Control": "no-store" },
  body: { error: "unavailable" },
};

/** The claude- models in Anthropic's reply, in its order, or null when it is not a model list. */
export function listClaudeModels(body: unknown): { id: string; label: string }[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const models: { id: string; label: string }[] = [];
  for (const entry of data) {
    const { id, display_name: name } = (entry ?? {}) as { id?: unknown; display_name?: unknown };
    if (typeof id !== "string" || !ANTHROPIC_MODEL_ID_PATTERN.test(id)) continue;
    models.push({ id, label: typeof name === "string" && name.trim() ? name.trim() : id });
  }
  return models;
}

export async function handleAnthropicModels(deps: {
  env: AnthropicModelsEnv;
  fetch: FetchLike;
  log?: (message: string) => void;
}): Promise<ApiResult<AnthropicModelsBody>> {
  const key = deps.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return unavailable;
  try {
    const response = await deps.fetch(ANTHROPIC_MODELS_URL, {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) {
      deps.log?.(`Anthropic answered HTTP ${response.status} for the model list`);
      return unavailable;
    }
    const models = listClaudeModels(await response.json());
    if (models === null) return unavailable;
    return {
      status: 200,
      headers: { "Cache-Control": MODELS_CACHE_CONTROL },
      body: { provider: "anthropic", models },
    };
  } catch (error) {
    // Only the kind of failure is logged: an upstream message could carry the request details.
    deps.log?.(
      `The Claude model list could not be read (${error instanceof Error ? error.name : "error"})`,
    );
    return unavailable;
  }
}
