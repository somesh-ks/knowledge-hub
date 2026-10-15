import { type HostNames, hostNamesFor } from "@dispatch/core/hosts";
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

/** The voice list, or why there is none: no key is set, or Speechify could not be read. */
export type VoiceCatalogue =
  | { kind: "voices"; voices: VoiceOption[] }
  | { kind: "no_key" }
  | { kind: "failed" };

/**
 * The English voices the key can use, from the hour-long cache or paged from Speechify. The voice
 * list, the samples and a new episode's host names all read it here. `signal` cuts a caller's wait
 * short; each page also has its own limit. Only the kind of a failure is logged: an upstream message
 * could carry the request details.
 */
export async function readVoiceCatalogue(
  deps: VoicesDeps,
  signal?: AbortSignal,
): Promise<VoiceCatalogue> {
  const key = deps.env.SPEECHIFY_API_KEY?.trim();
  if (!key) return { kind: "no_key" };
  const now = (deps.now ?? Date.now)();
  if (cache && now - cache.at < VOICES_TTL_MS) return { kind: "voices", voices: cache.voices };
  try {
    const byId = new Map<string, VoiceOption>();
    let cursor: string | undefined;
    for (let page = 0; page < VOICES_MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: "200", model: VOICES_MODEL, locale: "en" });
      if (cursor) query.set("cursor", cursor);
      const pageLimit = AbortSignal.timeout(VOICES_TIMEOUT_MS);
      const response = await deps.fetch(`${SPEECHIFY_VOICES_URL}?${query}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: signal ? AbortSignal.any([pageLimit, signal]) : pageLimit,
      });
      if (!response.ok) {
        deps.log?.(`Speechify answered HTTP ${response.status} for the voice list`);
        return { kind: "failed" };
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
    return { kind: "voices", voices };
  } catch (error) {
    deps.log?.(
      `The voice list could not be read (${error instanceof Error ? error.name : "error"})`,
    );
    return { kind: "failed" };
  }
}

export async function handleVoices(deps: VoicesDeps): Promise<ApiResult<VoicesBody>> {
  const defaults = voiceDefaults(deps.env);
  const catalogue = await readVoiceCatalogue(deps);
  switch (catalogue.kind) {
    case "no_key":
      return {
        status: 200,
        headers: { "Cache-Control": "no-store" },
        body: { voices: [], defaults },
      };
    case "failed":
      return {
        status: 502,
        headers: { "Cache-Control": "no-store" },
        body: { error: "unavailable" },
      };
    case "voices":
      return {
        status: 200,
        headers: { "Cache-Control": VOICES_CACHE_CONTROL },
        body: { voices: catalogue.voices, defaults },
      };
  }
}

/**
 * The voices that will read a request's two hosts, worked out as narration does (hostVoices in
 * narrate.ts): the request's own, else the configured defaults. A blank second voice in the
 * environment means the first voice reads both hosts, whichever voice that is.
 */
export function hostVoiceIds(
  request: { voice_id?: string | null; voice_id_b?: string | null },
  env: VoicesEnv,
): { a: string; b: string } {
  const a = request.voice_id ?? voiceDefaults(env).voice;
  return { a, b: request.voice_id_b ?? readVoiceIdB(withSecondVoice(env)) ?? a };
}

/**
 * How long a new discussion waits for its hosts' names before it goes without them. The lookup
 * starts beside the GitHub calls, so a cached list adds no wait and a slow Speechify at most this.
 */
export const HOST_NAMES_TIMEOUT_MS = 2000;

/**
 * The hosts' names for a new discussion, from the genders of the voices that will read it
 * (hostNamesFor in core). Undefined when they cannot be worked out in time: no key, a list that
 * failed or was slow, or a voice it does not hold. The engine then uses its gender-neutral pair, so
 * this never fails a request and never throws. Only the kind of a failure is logged.
 */
export async function resolveHostNames(
  request: { voice_id?: string | null; voice_id_b?: string | null },
  deps: VoicesDeps,
  signal: AbortSignal = AbortSignal.timeout(HOST_NAMES_TIMEOUT_MS),
): Promise<HostNames | undefined> {
  try {
    const catalogue = await readVoiceCatalogue(deps, signal);
    if (catalogue.kind === "no_key") {
      deps.log?.("Host names left to the engine: no Speechify key");
      return undefined;
    }
    // readVoiceCatalogue has already logged why the list could not be read.
    if (catalogue.kind === "failed") return undefined;
    const ids = hostVoiceIds(request, deps.env);
    const voiceA = catalogue.voices.find((voice) => voice.id === ids.a);
    const voiceB = catalogue.voices.find((voice) => voice.id === ids.b);
    if (!voiceA || !voiceB) {
      deps.log?.("Host names left to the engine: a host's voice is not in the voice list");
      return undefined;
    }
    return hostNamesFor(voiceA, voiceB);
  } catch (error) {
    deps.log?.(`Host names left to the engine (${error instanceof Error ? error.name : "error"})`);
    return undefined;
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
    // A last byte before the first makes the header invalid, which is ignored (RFC 9110, 14.1.1).
    if (match[2] !== "" && Number(match[2]) < start) return null;
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return [start, end];
}
