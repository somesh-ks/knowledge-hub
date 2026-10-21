import type { Env, ModelFamily, ModelRouting } from "@dispatch/core";
import type { Logger } from "../context.js";
import { ANTHROPIC_BASE, GEMINI_BASE } from "./providers.js";

export interface ResolvedModel {
  family: ModelFamily;
  id: string;
  /** Where the id came from: the provider's list, the owner's pin, or the config's known-good fallback. */
  source: "listed" | "pin" | "fallback";
}

export type ResolvedFamilies = Partial<Record<ModelFamily, ResolvedModel>>;

/** Release version of an id as numbers, or null when the id is not a plain generally available one. */
function versionOf(family: ModelFamily, id: string): number[] | null {
  let match: RegExpExecArray | null = null;
  if (family === "claude-sonnet" || family === "claude-haiku") {
    const name = family === "claude-sonnet" ? "sonnet" : "haiku";
    // claude-sonnet-5-5, claude-sonnet-5, optionally a dated snapshot (-20251001).
    match = new RegExp(`^claude-${name}-(\\d{1,2})(?:-(\\d{1,2}))?(?:-\\d{8})?$`).exec(id);
  } else if (family === "gemini-flash") {
    // Not -lite, and no preview, experimental, tts, live, image, audio or latest alias: those fail the whole-id match.
    match = /^gemini-(\d+)(?:\.(\d+))?-flash(?:-\d{3})?$/.exec(id);
  } else if (family === "gemini-flash-lite") {
    match = /^gemini-(\d+)(?:\.(\d+))?-flash-lite(?:-\d{3})?$/.exec(id);
  }
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0)];
}

function newer(a: number[], b: number[]): boolean {
  return a[0] !== b[0] ? (a[0] ?? 0) > (b[0] ?? 0) : (a[1] ?? 0) > (b[1] ?? 0);
}

/**
 * The newest generally available id of a family among `ids`, or null. Sonnet is picked among
 * Sonnets, Flash among Flash models that are not Flash-Lite, and so on; a preview, experimental,
 * TTS, live or image id, an alias such as -latest, and any other family (Opus, Pro) never match.
 * On a tie the plain alias wins over a dated snapshot.
 */
export function pickNewest(family: ModelFamily, ids: readonly string[]): string | null {
  let best: { id: string; version: number[] } | null = null;
  for (const id of ids) {
    const version = versionOf(family, id);
    if (!version) continue;
    if (
      !best ||
      newer(version, best.version) ||
      (!newer(best.version, version) && id.length < best.id.length)
    ) {
      best = { id, version };
    }
  }
  return best?.id ?? null;
}

async function listAnthropic(key: string, doFetch: typeof fetch): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = `${ANTHROPIC_BASE}/models?limit=100${after ? `&after_id=${after}` : ""}`;
    const response = await doFetch(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Anthropic model list answered HTTP ${response.status}`);
    const json = (await response.json()) as {
      data?: Array<{ id?: string }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const model of json.data ?? []) if (model.id) ids.push(model.id);
    if (!json.has_more || !json.last_id) break;
    after = json.last_id;
  }
  return ids;
}

async function listGemini(key: string, doFetch: typeof fetch): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = `${GEMINI_BASE}/models?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const response = await doFetch(url, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Gemini model list answered HTTP ${response.status}`);
    const json = (await response.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const model of json.models ?? []) {
      const methods = model.supportedGenerationMethods;
      if (model.name && (!methods || methods.includes("generateContent"))) {
        ids.push(model.name.replace(/^models\//, ""));
      }
    }
    if (!json.nextPageToken) break;
    token = json.nextPageToken;
  }
  return ids;
}

/**
 * Resolves every family the routing uses to a concrete model id, once at run start. Each provider
 * is listed once (Anthropic `GET /v1/models`, Gemini `GET /v1beta/models`); the newest id of a
 * family wins unless the listing is older than the config's fallback id. A family with an owner pin
 * uses it without listing. A listing that fails (or a provider without a key) uses the fallback id,
 * and the log says so. Jev is a version-pinned id, not listed. Every resolution is logged.
 */
export async function resolveFamilies(options: {
  routing: ModelRouting;
  env: Env;
  log: Logger;
  fetch?: typeof fetch;
}): Promise<ResolvedFamilies> {
  const { routing, env, log } = options;
  const doFetch = options.fetch ?? fetch;
  const used = new Set<ModelFamily>();
  for (const step of Object.values(routing.steps)) for (const e of step.chain) used.add(e.family);

  const listed = new Map<"anthropic" | "gemini", string[] | null>();
  const listOnce = async (provider: "anthropic" | "gemini"): Promise<string[] | null> => {
    if (listed.has(provider)) return listed.get(provider) ?? null;
    const key = provider === "anthropic" ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
    let ids: string[] | null = null;
    if (key) {
      try {
        ids = await (provider === "anthropic"
          ? listAnthropic(key, doFetch)
          : listGemini(key, doFetch));
      } catch (error) {
        log.warn(
          `Could not list ${provider} models; using the pinned ids from config/models.json`,
          {
            reason: error instanceof Error ? error.message.slice(0, 120) : "unknown",
          },
        );
      }
    }
    listed.set(provider, ids);
    return ids;
  };

  const resolved: ResolvedFamilies = {};
  for (const family of used) {
    const ids = routing.families[family];
    if (!ids) continue;
    let result: ResolvedModel;
    if (family === "jev") {
      result = { family, id: ids.pin ?? ids.fallback_id, source: ids.pin ? "pin" : "fallback" };
    } else if (ids.pin) {
      result = { family, id: ids.pin, source: "pin" };
    } else {
      const provider = family.startsWith("claude") ? "anthropic" : "gemini";
      const pick = pickNewest(family, (await listOnce(provider)) ?? []);
      const floor = versionOf(family, ids.fallback_id);
      const pickVersion = pick ? versionOf(family, pick) : null;
      result =
        pick && pickVersion && !(floor && newer(floor, pickVersion))
          ? { family, id: pick, source: "listed" }
          : { family, id: ids.fallback_id, source: "fallback" };
    }
    resolved[family] = result;
    log.info("Model resolved", { family, model: result.id, source: result.source });
  }
  return resolved;
}
