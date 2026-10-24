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
  // An own-property check: "constructor" is a key of every object, and the server's word is not trusted.
  if (Object.hasOwn(KNOWN, code)) return KNOWN[code] ?? "failed";
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

function parseAudio(
  value: unknown,
): { url: string; duration_ms: number; confirmed: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const { url, duration_ms, confirmed } = value as Json;
  if (!isPlayableUrl(url) || !isDuration(duration_ms)) return null;
  // A lookup only knows where a file would be. Only an explicit true means it is there.
  return { url, duration_ms, confirmed: confirmed === true };
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
  const isTime = (time: unknown): boolean => typeof time === "number" && Number.isFinite(time);
  const itemsOk = items.every(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Json).id === "string" &&
      isTime((item as Json).start_ms) &&
      isTime((item as Json).end_ms),
  );
  const sectionsOk = sections.every(
    (section: unknown) =>
      typeof section === "object" &&
      section !== null &&
      typeof (section as Json).slug === "string" &&
      isTime((section as Json).start_ms),
  );
  return itemsOk && sectionsOk ? (value as NarrationTimeline) : null;
}

/** GET /api/narrate. Free, and never makes audio. */
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
    whole: audio
      ? { url: audio.url, duration_ms: audio.duration_ms, timeline: parseTimeline(body.timeline) }
      : null,
  };
}

/** POST /api/narrate for one segment. This is the call that spends. */
export async function narrateSegment(
  digestId: string,
  key: string,
  deps: ApiDeps,
): Promise<NarrateResult> {
  const request: NarrateRequest = { digest: digestId, segment: key };
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

/** What a recording is called in copy: an episode has a transcript, a briefing its text. */
export type NarrationNoun = "briefing" | "episode";

/** What to tell the listener, and what to do next, naming the recording as the page does. */
export function failureCopy(reason: NarrationFailure, noun: NarrationNoun): string {
  switch (reason) {
    case "daily_cap":
      return "Daily narration limit reached. Try again tomorrow.";
    case "monthly_budget":
      return "This month's narration allowance is used up. It resets on the first.";
    case "not_narratable":
      return `This ${noun} cannot be read aloud.`;
    case "digest_not_found":
      return `This ${noun} is not ready for narration yet. Reload the page, then try again.`;
    case "segment_not_found":
      return "This page is out of date. Reload it, then try again.";
    case "unavailable":
      return "Narration ran into a problem on the server. Try again.";
    case "offline":
      return "You are offline. Reconnect, then try again.";
    case "failed":
      return "The audio could not be made. Try again.";
  }
}

/**
 * Refusals no retry can change; the segment queue remembers them too. A 503 `unavailable` is a
 * passing failure as often as not, so it offers Try again.
 */
const STANDING_REASONS: ReadonlySet<NarrationFailure> = new Set([
  "daily_cap",
  "monthly_budget",
  "not_narratable",
  "digest_not_found",
]);

/** The short line for the mini player, from the reason rather than the kind of error. */
function failureSummary(reason: NarrationFailure): string | undefined {
  switch (reason) {
    case "daily_cap":
      return "Daily limit reached";
    case "monthly_budget":
      return "Monthly allowance used up";
    case "not_narratable":
      return "Cannot be read aloud";
    case "digest_not_found":
    case "segment_not_found":
      return "Not ready for narration";
    case "unavailable":
      return "Narration failed on the server";
    case "offline":
      return "You are offline";
    case "failed":
      // The notice's own words, shortened: one failure is not told two ways.
      return "Audio could not be made";
    default:
      return undefined;
  }
}

/** What the player shows for a file the narration could not make. */
export function describeNarrationFailure(
  reason: NarrationFailure,
  noun: NarrationNoun,
): { message: string; summary?: string; standing: boolean } {
  // The notice has its own Try again where a retry helps, so the words are not repeated there.
  const message =
    reason === "failed"
      ? "The audio could not be made."
      : reason === "unavailable"
        ? "Narration ran into a problem on the server."
        : failureCopy(reason, noun);
  return { message, summary: failureSummary(reason), standing: STANDING_REASONS.has(reason) };
}
