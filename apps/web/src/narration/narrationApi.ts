/**
 * The two calls to /api/narrate, with every answer checked before it is trusted. Nothing here
 * throws: a refusal, a network failure and a page that is not JSON all come back as a reason the
 * interface can explain.
 */
import type { NarrateRequest, NarrationTimeline } from "../types/contracts";
import type { SegmentInfo } from "./narrationPlan";
import type { NarrateResult, NarrationFailure } from "./segmentQueue";

export interface ApiDeps {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  isOnline(): boolean;
}

export type LookupResult =
  | {
      ok: true;
      /** The track list in playing order, each with its file once narrated. */
      segments: SegmentInfo[];
      msPerCharacter: number;
      /** A finished single file for the whole briefing, when one exists. */
      whole: { url: string; duration_ms: number; timeline: NarrationTimeline | null } | null;
    }
  | { ok: false; reason: NarrationFailure };

/** The server's refusals that mean something specific to a listener. Every other one is "failed". */
const KNOWN: Record<string, NarrationFailure> = {
  wrong_passphrase: "wrong_passphrase",
  daily_cap: "daily_cap",
  monthly_budget: "monthly_budget",
  not_narratable: "not_narratable",
  digest_not_found: "digest_not_found",
  segment_not_found: "segment_not_found",
  unavailable: "unavailable",
};

type Json = Record<string, unknown>;

async function readJson(response: Response): Promise<Json | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Json) : null;
  } catch {
    return null;
  }
}

function refusal(response: Response, body: Json | null): NarrationFailure {
  const code = typeof body?.error === "string" ? body.error : "";
  const known = KNOWN[code];
  if (known) return known;
  // A method the function does not answer means this deployment has no narration at all. A gateway
  // error or a timeout page is a bad moment, not a missing feature.
  return response.status === 405 || response.status === 501 ? "unavailable" : "failed";
}

function networkFailure(deps: ApiDeps): NarrationFailure {
  return deps.isOnline() ? "failed" : "offline";
}

/** Audio is only ever played from https, or from this site. Anything else is not a file to trust. */
function isPlayableUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseAudio(value: unknown): { url: string; duration_ms: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { url, duration_ms } = value as Json;
  return isPlayableUrl(url) && isDuration(duration_ms) ? { url, duration_ms } : null;
}

function parseSegment(value: unknown): SegmentInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const { key, item_id, characters, audio } = value as Json;
  if (typeof key !== "string" || key === "") return null;
  if (item_id !== null && typeof item_id !== "string") return null;
  if (typeof characters !== "number" || !Number.isFinite(characters) || characters < 0) return null;
  return { key, item_id, characters, audio: parseAudio(audio) };
}

function parseTimeline(value: unknown): NarrationTimeline | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, items, sections } = value as Json;
  if (kind !== "marks" && kind !== "estimated") return null;
  if (!Array.isArray(items) || !Array.isArray(sections)) return null;
  return value as NarrationTimeline;
}

/** GET /api/narrate. Free, needs no passphrase, and never makes audio. */
export async function lookupNarration(digestId: string, deps: ApiDeps): Promise<LookupResult> {
  let response: Response;
  try {
    response = await deps.fetch(`/api/narrate?digest=${encodeURIComponent(digestId)}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, reason: networkFailure(deps) };
  }
  const body = await readJson(response);
  if (response.status !== 200 || !body) return { ok: false, reason: refusal(response, body) };

  const listed = Array.isArray(body.segments) ? body.segments.map(parseSegment) : [];
  const segments = listed.filter((segment): segment is SegmentInfo => segment !== null);
  // One malformed entry would shift every story after it, so the whole list is refused.
  if (segments.length === 0 || segments.length !== listed.length) {
    return { ok: false, reason: "failed" };
  }
  const audio = parseAudio(body.audio);
  return {
    ok: true,
    segments,
    msPerCharacter: isDuration(body.ms_per_character) ? body.ms_per_character : 0,
    whole: audio ? { ...audio, timeline: parseTimeline(body.timeline) } : null,
  };
}

/** POST /api/narrate for one segment. This is the call that spends. */
export async function narrateSegment(
  digestId: string,
  key: string,
  passphrase: string,
  deps: ApiDeps,
): Promise<NarrateResult> {
  const request: NarrateRequest = { digest: digestId, passphrase, segment: key };
  let response: Response;
  try {
    response = await deps.fetch("/api/narrate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, reason: networkFailure(deps) };
  }
  const body = await readJson(response);
  if (response.status !== 200 || !body) return { ok: false, reason: refusal(response, body) };
  const segment = parseSegment(body.segment);
  if (!segment?.audio || segment.key !== key) return { ok: false, reason: "failed" };
  return { ok: true, url: segment.audio.url };
}

/** What to tell the listener, and what to do next. Null where the interface asks instead of telling. */
export const FAILURE_COPY: Record<NarrationFailure, string | null> = {
  passphrase_required: null,
  wrong_passphrase: "That passphrase is not right. Check it and try again.",
  daily_cap: "Today's limit for new narrations is reached. This briefing can be narrated tomorrow.",
  monthly_budget: "This month's narration allowance is used up. It resets on the first.",
  not_narratable: "This briefing cannot be read aloud. The text is still here to read.",
  digest_not_found:
    "This briefing is not ready for narration yet. Reload the page, then try again.",
  segment_not_found: "This page is out of date. Reload it, then press play again.",
  unavailable: "Narration is not available right now. The text is still here to read.",
  offline: "You are offline. Reconnect, then press play again.",
  failed: "The audio could not be made. Press play to try again.",
};
