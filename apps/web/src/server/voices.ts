import { DEFAULT_VOICE_ID } from "@dispatch/engine/audio";
import { readVoiceId, readVoiceIdB, withSecondVoice } from "./config";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";

/**
 * GET /api/voices: the English Speechify voices the key can use, for the voice pickers in Settings
 * and the Create panel. The key stays on the server; neither it nor anything Speechify says reaches
 * the response or a log line. The list is held in memory for an hour and shared by the CDN.
 */

export interface VoicesEnv {
  SPEECHIFY_API_KEY?: string;
  /** The voices Default stands for, as narration reads them (config.ts). */
  SPEECHIFY_VOICE_ID?: string;
  SPEECHIFY_VOICE_ID_B?: string;
}

export interface VoicesDeps {
  env: VoicesEnv;
  fetch: FetchLike;
  log?: (message: string) => void;
  now?: () => number;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  language: string;
  preview_url: string | null;
}

/** The voice each host reads with when none is chosen, so Default can be named and heard. */
export interface VoiceDefaults {
  voice: string;
  voice_b: string;
}

export type VoicesBody =
  | { voices: VoiceOption[]; defaults: VoiceDefaults }
  | { error: "unavailable" };

/** Default in each host's place, worked out as narration does: unset second voice means dominic_32. */
export function voiceDefaults(env: VoicesEnv): VoiceDefaults {
  const voice = readVoiceId(env) ?? DEFAULT_VOICE_ID;
  return { voice, voice_b: readVoiceIdB(withSecondVoice(env)) ?? voice };
}

export const SPEECHIFY_VOICES_URL = "https://api.speechify.ai/v1/voices";
/** The engine's synthesis model: only voices that speak it can be used. */
export const VOICES_MODEL = "simba-3.2";
export const VOICES_TIMEOUT_MS = 10_000;
export const VOICES_MAX_PAGES = 20;
export const VOICES_TTL_MS = 60 * 60 * 1000;
export const VOICES_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

let cache: { at: number; voices: VoiceOption[] } | null = null;

/** For tests. */
export function resetVoicesCache(): void {
  cache = null;
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function localesOf(raw: Record<string, unknown>): string[] {
  const found: string[] = [];
  const own = asString(raw.locale);
  if (own) found.push(own);
  if (Array.isArray(raw.models)) {
    for (const model of raw.models) {
      const languages = (model as { languages?: unknown } | null)?.languages;
      if (!Array.isArray(languages)) continue;
      for (const language of languages) {
        const locale = asString((language as { locale?: unknown } | null)?.locale);
        if (locale) found.push(locale);
      }
    }
  }
  return found;
}

function previewOf(raw: Record<string, unknown>): string | null {
  for (const key of ["preview_audio", "preview_url"]) {
    const value = asString(raw[key]);
    if (value?.startsWith("https://")) return value;
  }
  return null;
}

/** Pure part: one page of the catalogue to English voices. */
export function parseVoices(body: unknown): VoiceOption[] {
  const list = Array.isArray(body)
    ? body
    : ((body as { voices?: unknown; data?: unknown } | null)?.voices ??
      (body as { data?: unknown } | null)?.data);
  if (!Array.isArray(list)) return [];
  const out: VoiceOption[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = asString(raw.id);
    if (!id) continue;
    const locales = localesOf(raw);
    const english = locales.find((locale) => locale.toLowerCase().startsWith("en"));
    if (!english) continue;
    out.push({
      id,
      name: asString(raw.display_name) ?? id,
      gender: asString(raw.gender) ?? "",
      language: english,
      preview_url: previewOf(raw),
    });
  }
  return out;
}

export async function handleVoices(deps: VoicesDeps): Promise<ApiResult<VoicesBody>> {
  const key = deps.env.SPEECHIFY_API_KEY?.trim();
  const defaults = voiceDefaults(deps.env);
  if (!key) {
    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      body: { voices: [], defaults },
    };
  }
  const now = (deps.now ?? Date.now)();
  if (cache && now - cache.at < VOICES_TTL_MS) {
    return {
      status: 200,
      headers: { "Cache-Control": VOICES_CACHE_CONTROL },
      body: { voices: cache.voices, defaults },
    };
  }
  try {
    const byId = new Map<string, VoiceOption>();
    let cursor: string | undefined;
    for (let page = 0; page < VOICES_MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: "200", model: VOICES_MODEL, locale: "en" });
      if (cursor) query.set("cursor", cursor);
      const response = await deps.fetch(`${SPEECHIFY_VOICES_URL}?${query}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(VOICES_TIMEOUT_MS),
      });
      if (!response.ok) {
        deps.log?.(`Speechify answered HTTP ${response.status} for the voice list`);
        return {
          status: 502,
          headers: { "Cache-Control": "no-store" },
          body: { error: "unavailable" },
        };
      }
      const body: unknown = await response.json();
      for (const voice of parseVoices(body)) byId.set(voice.id, voice);
      const { has_more: hasMore, next_cursor: next } = (body ?? {}) as {
        has_more?: unknown;
        next_cursor?: unknown;
      };
      cursor = hasMore === true && typeof next === "string" && next !== "" ? next : undefined;
      if (cursor === undefined) break;
    }
    const voices = [...byId.values()].sort(
      (a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : 1),
    );
    cache = { at: now, voices };
    return {
      status: 200,
      headers: { "Cache-Control": VOICES_CACHE_CONTROL },
      body: { voices, defaults },
    };
  } catch (error) {
    // Only the kind of failure is logged: an upstream message could carry the request details.
    deps.log?.(
      `The voice list could not be read (${error instanceof Error ? error.name : "error"})`,
    );
    return {
      status: 502,
      headers: { "Cache-Control": "no-store" },
      body: { error: "unavailable" },
    };
  }
}

/**
 * GET /api/voice-sample?voice=<id>: a voice's sample, served from the site. The page's
 * Content-Security-Policy plays audio only from its own address and the Blob store, so a sample on
 * Speechify's host would not play. Only a sample in the voice list can be asked for, by voice id,
 * so this can fetch nothing else.
 */
export const SAMPLE_MAX_BYTES = 2_000_000;
export const SAMPLE_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800";
const VOICE_PARAM = /^[A-Za-z0-9_-]{1,64}$/;

export type SampleResult =
  | { kind: "audio"; body: ArrayBuffer; contentType: string }
  | {
      kind: "error";
      result: ApiResult<{ error: "invalid_request" | "not_found" | "unavailable" }>;
    };

const sampleError = (
  status: number,
  error: "invalid_request" | "not_found" | "unavailable",
): SampleResult => ({
  kind: "error",
  result: { status, headers: { "Cache-Control": "no-store" }, body: { error } },
});

export async function handleVoiceSample(
  voiceId: string | null,
  deps: VoicesDeps,
): Promise<SampleResult> {
  if (!voiceId || !VOICE_PARAM.test(voiceId)) return sampleError(400, "invalid_request");
  const list = await handleVoices(deps);
  if (!("voices" in list.body)) return sampleError(502, "unavailable");
  const url = list.body.voices.find((voice) => voice.id === voiceId)?.preview_url;
  if (!url) return sampleError(404, "not_found");
  try {
    const response = await deps.fetch(url, { signal: AbortSignal.timeout(VOICES_TIMEOUT_MS) });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok || declared > SAMPLE_MAX_BYTES) {
      deps.log?.(`A voice sample answered HTTP ${response.status}`);
      return sampleError(502, "unavailable");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > SAMPLE_MAX_BYTES) return sampleError(502, "unavailable");
    const type = response.headers.get("content-type") ?? "";
    return { kind: "audio", body, contentType: type.startsWith("audio/") ? type : "audio/mpeg" };
  } catch (error) {
    deps.log?.(
      `A voice sample could not be read (${error instanceof Error ? error.name : "error"})`,
    );
    return sampleError(502, "unavailable");
  }
}

/**
 * The part of `size` bytes a Range header asks for, as [start, end] inclusive, or null for the
 * whole file. Safari asks for bytes before it plays a sample and wants a 206 answer. "unsatisfiable"
 * is a range past the end.
 */
export function byteRange(
  header: string | null,
  size: number,
): [number, number] | null | "unsatisfiable" {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    // A suffix: the last N bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}
