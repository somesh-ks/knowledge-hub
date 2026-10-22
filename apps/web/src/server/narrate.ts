import {
  AudioTimeline,
  type Digest,
  DigestId,
  parseDigestFile,
  podcastVoices,
  ScheduleFile,
} from "@dispatch/core";
import {
  buildSpokenText,
  createSpeechifyClient,
  DEFAULT_MODEL,
  DEFAULT_MONTHLY_CHARS,
  DEFAULT_VOICE_ID,
  describeRefusal,
  isMarksUnavailable,
  resolveTimeline,
  SpeechifyError,
  type SpeechMark,
  type SpeechSynthesizer,
  type SpokenSegment,
  type SpokenText,
  type SynthesisRequest,
  segmentSpokenText,
  usageMonth,
} from "@dispatch/engine/audio";
import { SEGMENT_CACHE_SECONDS, turnKey } from "@dispatch/engine/segments";
import { EPISODE_ID, parseEpisodeFile } from "../lib/episodeFile";
import type { StreamDoc } from "../lib/liveStream";
import type { SegmentMarks } from "../lib/segmentMarks";
import type {
  NarrateLookupResponse,
  NarrateResponse,
  NarrateSegmentResponse,
  NarrationSegment,
} from "../types/contracts";
import { type BlobWriteOptions, type NarrateBlobStore, readFresh } from "./blobStore";
import {
  type BlobCredentials,
  MS_PER_CHARACTER,
  type NarrateConfig,
  narrateSecretsOf,
  readNarrateConfig,
  readPublicBlobBase,
  readVoiceId,
  readVoiceIdB,
  type ServerEnv,
} from "./config";
import {
  BLOB_CALL_TIMEOUT_MS,
  BLOB_UPLOAD_TIMEOUT_MS,
  FUNCTION_MAX_DURATION_S,
  NARRATE_OVERHEAD_MS,
  PRE_SYNTHESIS_BOUND_MS,
  SYNTHESIS_DEADLINE_MS,
} from "./functionLimits.mjs";
import { isSameOrigin, MAX_BODY_CHARS } from "./generate";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";
import { NARRATE_DAILY_CAP } from "./limits";
import {
  deriveSegmentMarks,
  describeSegments,
  SEGMENT_KEY,
  segmentAudio,
  segmentHash,
  segmentMarksPath,
  segmentPath,
} from "./narrateSegments";
import {
  addRepeat,
  type ChargePlan,
  type NarrationMode,
  parseState,
  planCharge,
  serializeState,
  usageKey,
} from "./narrationState";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";

/**
 * /api/narrate: narration made when a listener presses Play, not ahead of time.
 *
 * GET lists a digest's segments (the intro, each story, an outro) with the address each one's audio
 * would have. It never narrates and never touches the store. POST checks the request and the limits
 * and has Speechify read either one segment or the whole digest, stores the result in Blob, and
 * returns it.
 *
 * A podcast episode (an id like ep-20261007-1930) goes through the same two calls, with one segment
 * per turn, keyed t<idx>. Each speaker has a voice: "a" reads in the configured voice and "b" in
 * SPEECHIFY_VOICE_ID_B, or in the first voice when that is unset. The segment's file name already
 * holds the voice, and the episode is charged under the pair of voices. An episode is never made
 * as one file: that request is refused as not narratable.
 *
 * The function keeps no state of its own. Everything it knows is in the Blob store: the audio, the
 * whole-digest timeline, a marker while a whole digest is being narrated, and one document a month
 * with the characters charged and the digests they were charged for (narrationState.ts). Everything
 * with a side effect is a parameter (fetch, the clock, the deadlines, the store, the digest files),
 * so the whole flow is tested with fakes and no network.
 *
 * What each call costs the store. ADVANCED operations (put) are the scarce ones, 2,000 a month;
 * SIMPLE ones (head, an uncached read) have 10,000; a delete and a cached read are free. Running
 * out locks the store for 30 days.
 *
 *   GET                              0           anyone may call it, so it asks the store nothing
 *   POST segment, first of a digest  3 advanced  the month's charge, then the segment and its word
 *                                                marks (2 when Speechify gave no marks)
 *                                    3 simple    the segment's head; the charge document's head and
 *                                                read
 *   POST segment, later ones         2 advanced  the segment and its word marks
 *                                    2 simple    as above, but the charge document has not changed,
 *                                                so its read is a cache hit and free
 *   POST segment, already narrated   0 advanced
 *   POST whole digest                4 advanced  the marker, the charge, the MP3, the timeline
 *                                                (3 when the digest is already charged)
 *   any POST that fails after        +1 advanced the failed attempt's characters, added to the
 *   reaching Speechify                           month's document
 *
 * A digest of 20 segments (the intro, 18 stories, the sign-off) narrated story by story is therefore
 * 1 + 20 * 2 = 41 advanced operations, about 48 such digests a month.
 * narrate.test.ts counts them and fails above 42. GET /api/narrate-marks reads the marks by their
 * public URL: one SIMPLE operation when the CDN has not seen it, and never an advanced one.
 */

export const audioKey = (id: string): string => `audio/${id}.mp3`;
export const timelineKey = (id: string): string => `timeline/${id}.json`;
export const markerKey = (id: string): string => `state/narrating-${id}.json`;

/**
 * The lifetime the engine gives a narration. The URL is fixed per digest, so a long cache would let a
 * browser pair an old MP3 with a new timeline.
 */
const AUDIO_CACHE_SECONDS = 60 * 60;
/** The timeline and the bookkeeping files must be current. 60 seconds is the shortest Blob allows. */
const JSON_CACHE_SECONDS = 60;
const JSON_FILE = { contentType: "application/json", cacheSeconds: JSON_CACHE_SECONDS } as const;

/** A paid narration should survive a blip in the store. */
export const UPLOAD_ATTEMPTS = 3;
export const UPLOAD_RETRY_DELAY_MS = 500;

const FUNCTION_LIMIT_MS = FUNCTION_MAX_DURATION_S * 1000;
/**
 * Kept free at the very end: the wait for the marker to be deleted, and sending the answer. No
 * upload, pause or count is started that would run into it.
 */
export const RESPONSE_MARGIN_MS = 1500;
/** With less time than this left for Speechify, nothing useful can be synthesized. */
const MIN_SYNTHESIS_MS = 1000;
/** With less time than this left, an upload attempt is not worth starting. */
const MIN_UPLOAD_MS = 500;

/**
 * A marker older than the longest a function can live was left by one that was stopped. The slack
 * covers the difference between the store's clock and the function's.
 */
export const MARKER_TTL_MS = FUNCTION_LIMIT_MS + 30_000;
/**
 * How long a finished request waits for its marker to be deleted. Cleaning up must never hold an
 * answer back: a marker that is not cleared in this time expires by itself.
 */
export const MARKER_CLEAR_WAIT_MS = 500;

/** A lookup depends only on the build and the configuration, so the CDN may answer for a minute. */
export const LOOKUP_CACHE_CONTROL = "public, s-maxage=60";

const MAX_DIGEST_ID_CHARS = 32;
/** One retry for a rate limit, and only a short wait: the deadline is the real bound. */
const SPEECHIFY_RETRIES = 1;
const SPEECHIFY_MAX_RETRY_WAIT_MS = 5000;

/** The digest files this deployment was built with. */
export interface DigestSource {
  /** The digest file's text, or null when the deployment has no such digest. */
  readDigest(id: string): Promise<string | null>;
  /** The timeline the audio workflow committed next to the digest, or null. Not yet validated. */
  readTimeline(id: string): Promise<unknown>;
  /**
   * config/schedule.json as this build holds it, not yet validated, or null when there is none. It
   * names the voices of the Daily and Weekly briefings. Optional: without it the server's voice
   * reads every briefing.
   */
  readSchedule?(): Promise<unknown>;
}

/**
 * The voice the schedule gives a briefing: the shared Podcast voice, which a weekly digest (its id
 * ends in "-weekly") or a daily one reads the same way the engine does (podcastVoices). Undefined when the schedule is missing, unreadable or sets
 * none, and the server's voice applies. The schedule is part of the build, so this asks no one.
 */
async function scheduledVoice(source: DigestSource, id: string): Promise<string | undefined> {
  if (isEpisodeId(id)) return undefined;
  try {
    const parsed = ScheduleFile.safeParse(await source.readSchedule?.());
    if (!parsed.success) return undefined;
    return (
      podcastVoices(parsed.data, id.endsWith("-weekly") ? "weekly" : "daily").voice_id ?? undefined
    );
  } catch {
    return undefined;
  }
}

/** The episode files this deployment was built with. */
export interface EpisodeBundle {
  /** The episode file's text, or null when the deployment has no such episode. */
  readEpisode(id: string): Promise<string | null>;
}

/** A clock that runs out: a signal that aborts when time is up, and a way to stop the clock. */
export interface Deadline {
  signal: AbortSignal;
  cancel(): void;
}

/** The real clock. The reason is a TimeoutError, which the Speechify client reports as a timeout. */
export function startDeadline(milliseconds: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The deadline passed", "TimeoutError"));
  }, milliseconds);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export interface NarrateDeps {
  env: ServerEnv;
  /** Reaches Speechify. The Blob store goes through `openBlob`. */
  fetch: FetchLike;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  /** The shared per-minute burst cap (D150): 0 to go ahead, else the seconds to wait. */
  burst?: () => Promise<number>;
  openBlob: (credentials: BlobCredentials) => NarrateBlobStore;
  digests: DigestSource;
  /** Podcast episodes. Left out, no episode can be found. */
  episodes?: EpisodeBundle;
  /** The live copy of an episode that is still being written. Left out, there is none. */
  liveEpisodes?: LiveEpisodes;
  /** `purpose` names the clock ("setup", "synthesis", "repeat", "marker"); the real one ignores it. */
  startDeadline: (milliseconds: number, purpose?: string) => Deadline;
  log?: (message: string) => void;
}

/** The lookup has no store among its dependencies: it cannot spend an operation. */
export type LookupDeps = Pick<NarrateDeps, "env" | "digests" | "episodes" | "liveEpisodes" | "log">;

export interface NarrateInput {
  bodyText: string;
  /** The request's Origin header, if the browser sent one. */
  origin: string | null;
  /** The origin the request was made to. */
  expectedOrigin: string;
  /** Reads the OIDC token Vercel puts on the request, for a store connected that way. */
  requestOidcToken?: () => string | null;
}

export interface LookupInput {
  /** The `digest` query parameter. */
  digest: string | null;
  /** The name of every query parameter in the request, repeats included. */
  params: readonly string[];
}

/** What any of the three calls can answer: the lookup, the whole digest, one segment. */
export type NarrateBody = NarrateLookupResponse | NarrateResponse | NarrateSegmentResponse;
type NarrateResult = ApiResult<NarrateBody>;

const unavailable: NarrateResult = { status: 503, body: { status: 503, error: "unavailable" } };
const invalid: NarrateResult = { status: 400, body: { status: 400, error: "invalid_request" } };
const segmentNotFound: NarrateResult = {
  status: 404,
  body: { status: 404, error: "segment_not_found" },
};
const digestNotFound: NarrateResult = {
  status: 404,
  body: { status: 404, error: "digest_not_found" },
};
const notNarratable: NarrateResult = {
  status: 422,
  body: { status: 422, error: "not_narratable" },
};
const monthlyBudget: NarrateResult = {
  status: 429,
  body: { status: 429, error: "monthly_budget" },
};
const synthesisFailed: NarrateResult = {
  status: 502,
  body: { status: 502, error: "synthesis_failed" },
};
const storageFailed: NarrateResult = {
  status: 502,
  body: { status: 502, error: "storage_failed" },
};
const tookTooLong: NarrateResult = { status: 504, body: { status: 504, error: "took_too_long" } };

function inProgress(retryAfterSeconds: number): NarrateResult {
  return {
    status: 409,
    headers: { "Retry-After": String(retryAfterSeconds) },
    body: { status: 409, error: "in_progress", retry_after_s: retryAfterSeconds },
  };
}

function dailyCap(retryAfterSeconds: number): NarrateResult {
  return {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
    body: { status: 429, error: "daily_cap", retry_after_s: retryAfterSeconds },
  };
}

/** Whether an id names a podcast episode (ep-YYYYMMDD-HHmm) and not a briefing. */
export const isEpisodeId = (id: string): boolean => EPISODE_ID.test(id);

/**
 * A digest id from a query parameter or a body field, or null when it is not one. A podcast
 * episode's id counts: it is narrated the same way, one segment at a time.
 */
export function parseDigestId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_DIGEST_ID_CHARS) return null;
  if (isEpisodeId(value)) return value;
  const parsed = DigestId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface ParsedNarrateRequest {
  digest: string;
  /** Present when the request is for one segment. */
  segment?: string;
}

/**
 * Pulls the digest id and the optional segment key out of a JSON body, or null when it is not that
 * shape. A `passphrase` field that a page built before D159 still sends is ignored.
 */
export function parseNarrateRequest(bodyText: string): ParsedNarrateRequest | null {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { digest, segment } = parsed as { digest?: unknown; segment?: unknown };
  const id = parseDigestId(digest);
  if (id === null) return null;
  if (segment === undefined) return { digest: id };
  // A key that is sent has to be one. Anything else must not fall through to the whole digest, which
  // costs far more than the caller asked for.
  if (typeof segment !== "string" || !SEGMENT_KEY.test(segment)) return null;
  return { digest: id, segment };
}

interface Narration {
  url: string;
  timeline: AudioTimeline;
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Built field by field, so nothing in a stored timeline reaches the page unasked. */
function narrationFields(narration: Narration) {
  const { timeline } = narration;
  return {
    audio: { url: narration.url, duration_ms: timeline.duration_ms },
    timeline: {
      kind: timeline.timeline,
      items: timeline.items.map((item) => ({
        id: item.id,
        section: item.section,
        start_ms: item.start_ms,
        end_ms: item.end_ms,
      })),
      sections: timeline.sections.map((section) => ({
        slug: section.slug,
        start_ms: section.start_ms,
      })),
    },
  };
}

function ready(narration: Narration): NarrateResult {
  return { status: 200, body: { status: 200, ...narrationFields(narration) } };
}

/** A timeline counts only when it is well formed and belongs to this digest. */
function timelineFor(value: unknown, id: string): AudioTimeline | null {
  const parsed = AudioTimeline.safeParse(value);
  return parsed.success && parsed.data.digest === id ? parsed.data : null;
}

function parseJson(text: string | null | undefined): unknown {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A whole-digest narration exists when the store has the MP3 and there is a timeline for it: the
 * one this function stored, or, for a digest the audio workflow narrated, the one committed next to
 * the digest. Only POST asks this; the lookup never asks the store.
 */
async function findNarration(
  blob: NarrateBlobStore,
  digests: DigestSource,
  id: string,
): Promise<Narration | null> {
  const audio = await blob.head(audioKey(id));
  if (!audio || !isHttps(audio.url)) return null;
  const stored = await readFresh(blob, timelineKey(id));
  const timeline =
    timelineFor(parseJson(stored?.text), id) ?? timelineFor(await digests.readTimeline(id), id);
  return timeline ? { url: audio.url, timeline } : null;
}

interface Script {
  digest: Digest;
  /** The whole narration. Its length is what the digest is charged. */
  spoken: SpokenText;
  /** The same text, cut into the stretches that are narrated one at a time. */
  segments: SpokenSegment[];
}

/**
 * The digest and what is said of it, read from the bundle, or the answer to send when there is
 * nothing to say. It touches neither the store nor Speechify, so a request for something that does
 * not exist is refused before it can cost anything.
 */
async function loadScript(
  digests: DigestSource,
  id: string,
  log: (message: string) => void,
  secrets: readonly string[],
): Promise<Script | NarrateResult> {
  const text = await digests.readDigest(id);
  if (text === null) return digestNotFound;
  try {
    const digest = parseDigestFile(text);
    if (digest.id !== id) throw new Error(`the file holds digest ${digest.id}`);
    const spoken = buildSpokenText(digest);
    return { digest, spoken, segments: segmentSpokenText(spoken) };
  } catch (error) {
    log(`narrate ${id}: cannot be read aloud: ${describeError(error, secrets)}`);
    return notNarratable;
  }
}

interface EpisodeScript {
  /** Only what narrating needs of it: the voices the episode asked for. */
  episode: { request: AskedVoices };
  /** One per turn that has words, in the order they are said. Keyed `t<idx>`. */
  segments: SpokenSegment[];
  /** Who reads each segment, by its key. */
  speakers: Map<string, "a" | "b">;
  /** The length of everything said. It is what the episode is charged. */
  characters: number;
  /** Read from a live copy that is still growing, so a lookup of it must not be cached. */
  live?: boolean;
}

/** The segment key of a turn, shared with the engine, which narrates a new episode ahead of time. */
export { turnKey };

/** The live copy of an episode being written, by its id; null when there is none. */
export type LiveEpisodes = (id: string) => Promise<StreamDoc | null>;

/** The turns written so far, as an episode's script. A later copy only adds turns at the end. */
function liveEpisodeScript(doc: StreamDoc): EpisodeScript {
  const known = new Set(doc.stories.map((story) => story.item_id));
  const segments: SpokenSegment[] = [];
  const speakers = new Map<string, "a" | "b">();
  doc.turns.forEach((turn, idx) => {
    if (turn.text === "") return;
    const key = turnKey(idx);
    segments.push({
      key,
      itemId: turn.item_id !== undefined && known.has(turn.item_id) ? turn.item_id : null,
      text: turn.text,
    });
    speakers.set(key, turn.speaker);
  });
  const characters = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  return {
    episode: { request: { voice_id: doc.voices.a, voice_id_b: doc.voices.b } },
    segments,
    speakers,
    characters,
    live: doc.status === "writing",
  };
}

/**
 * An episode and what is said in it, read from the bundle, or the answer to send when there is
 * nothing to say. Like loadScript, it touches neither the store nor Speechify.
 */
async function loadEpisodeScript(
  episodes: EpisodeBundle | undefined,
  id: string,
  log: (message: string) => void,
  secrets: readonly string[],
  streams?: LiveEpisodes,
): Promise<EpisodeScript | NarrateResult> {
  const text = (await episodes?.readEpisode(id)) ?? null;
  if (text === null) {
    // Not committed here yet: an episode still being written is narrated from its live copy. The
    // committed file wins as soon as this build has it, so the two never disagree for long.
    const live = streams ? await streams(id).catch(() => null) : null;
    return live ? liveEpisodeScript(live) : digestNotFound;
  }
  try {
    const episode = parseEpisodeFile(text);
    if (episode.id !== id) throw new Error(`the file holds episode ${episode.id}`);
    const known = new Set(episode.sources.map((source) => source.item_id));
    const segments: SpokenSegment[] = [];
    const speakers = new Map<string, "a" | "b">();
    for (const turn of episode.turns) {
      const key = turnKey(turn.idx);
      // A turn that names a story the episode does not list belongs to no story.
      const itemId = turn.item_id !== null && known.has(turn.item_id) ? turn.item_id : null;
      segments.push({ key, itemId, text: turn.text });
      speakers.set(key, turn.speaker);
    }
    const characters = segments.reduce((sum, segment) => sum + segment.text.length, 0);
    return { episode, segments, speakers, characters };
  } catch (error) {
    log(`narrate ${id}: cannot be read aloud: ${describeError(error, secrets)}`);
    return notNarratable;
  }
}

/** The voices of the two hosts. The second falls back to the first. */
interface HostVoices {
  a: string;
  b: string;
}

/** The voices an episode asked for, if any. The body of a narration request is never one of them. */
interface AskedVoices {
  voice_id?: string | null | undefined;
  voice_id_b?: string | null | undefined;
}

function hostVoices(env: ServerEnv, asked: AskedVoices = {}): HostVoices | null {
  const a = readVoiceId(env);
  const b = readVoiceIdB(env);
  if (a === null || b === null) return null;
  const first = asked.voice_id ?? a ?? DEFAULT_VOICE_ID;
  return { a: first, b: asked.voice_id_b ?? b ?? first };
}

/** GET /api/narrate?digest=<ep-id>: the turns of an episode and where their audio would be. */
async function lookupEpisode(id: string, deps: LookupDeps): Promise<NarrateResult> {
  const log = deps.log ?? (() => {});
  let script: EpisodeScript | NarrateResult;
  try {
    script = await loadEpisodeScript(deps.episodes, id, log, [], deps.liveEpisodes);
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, [])}`);
    return unavailable;
  }
  if (!("episode" in script)) return script;
  const voices = hostVoices(deps.env, script.episode.request);
  if (voices === null) return unavailable;
  return {
    status: 200,
    // A script still being written grows between two lookups, so it is not kept at the edge.
    headers: { "Cache-Control": script.live ? "private, no-store" : LOOKUP_CACHE_CONTROL },
    body: {
      status: 200,
      // An episode is narrated turn by turn. There is no whole-episode file to offer.
      audio: null,
      timeline: null,
      segments: describeSegments(
        script.segments,
        readPublicBlobBase(deps.env),
        id,
        (key) => (script.speakers.get(key) === "b" ? voices.b : voices.a),
        DEFAULT_MODEL,
      ),
      ms_per_character: MS_PER_CHARACTER,
    },
  };
}

/** GET /api/narrate?digest=<id>. */
export async function handleNarrationLookup(
  input: LookupInput,
  deps: LookupDeps,
): Promise<NarrateResult> {
  const log = deps.log ?? (() => {});
  // Before anything else: `digest`, once, is the whole query. The answer is cached by URL, so any
  // other parameter would only be a way to get past the cache and make the function run again.
  if (input.params.some((name) => name !== "digest") || input.params.length > 1) return invalid;
  const id = parseDigestId(input.digest);
  if (id === null) return invalid;
  if (isEpisodeId(id)) return lookupEpisode(id, deps);

  let script: Script | NarrateResult;
  try {
    script = await loadScript(deps.digests, id, log, []);
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, [])}`);
    return unavailable;
  }
  if (!("spoken" in script)) return script;

  const envVoice = readVoiceId(deps.env);
  if (envVoice === null) return unavailable;
  const voice = (await scheduledVoice(deps.digests, id)) ?? envVoice;

  // Anyone can call this, as often as they like, so it asks the store nothing at all: every store
  // operation is metered and running out locks the store for a month. A segment's address follows
  // from its text and the voice, so it is worked out here and left for the page to try.
  // Whole-digest audio is reported only when the build carries it: the address in the digest file
  // and the timeline committed beside it.
  let whole: Narration | null = null;
  try {
    const timeline = timelineFor(await deps.digests.readTimeline(id), id);
    const audio = script.digest.audio;
    if (timeline && audio && isHttps(audio.url)) whole = { url: audio.url, timeline };
  } catch (error) {
    log(`lookup of ${id}: the bundled timeline could not be read: ${describeError(error, [])}`);
  }

  return {
    status: 200,
    headers: { "Cache-Control": LOOKUP_CACHE_CONTROL },
    body: {
      status: 200,
      ...(whole ? narrationFields(whole) : { audio: null, timeline: null }),
      segments: describeSegments(
        script.segments,
        readPublicBlobBase(deps.env),
        id,
        voice ?? DEFAULT_VOICE_ID,
        DEFAULT_MODEL,
      ),
      ms_per_character: MS_PER_CHARACTER,
    },
  };
}

interface Session {
  id: string;
  /** What the log calls this request: the digest, and the segment when it is for one. */
  label: string;
  config: NarrateConfig;
  blob: NarrateBlobStore;
  deps: NarrateDeps;
  secrets: string[];
  log: (message: string) => void;
  /** When the request arrived. Every time limit below is counted from here. */
  startedAt: number;
  /** One clock for every store call made before synthesis. */
  setup: Deadline;
  /** Set once a request has been sent to Speechify, which is when characters may be billed. */
  reachedSpeechify: boolean;
}

const voiceOf = (config: NarrateConfig): string => config.voiceId ?? DEFAULT_VOICE_ID;
const elapsed = (session: Session): number => session.deps.now() - session.startedAt;

/**
 * How long Speechify may take from now. It is counted from the start of the request, not from the
 * start of synthesis, and it always ends NARRATE_OVERHEAD_MS before the function's limit: time
 * already spent on the checks and the store comes out of the synthesis, never out of the time
 * kept for storing what was paid for.
 */
function synthesisBudget(session: Session): number {
  return Math.min(
    SYNTHESIS_DEADLINE_MS,
    FUNCTION_LIMIT_MS - NARRATE_OVERHEAD_MS - elapsed(session),
  );
}

/** How long is left before the function has to start answering. */
const timeLeft = (session: Session): number =>
  FUNCTION_LIMIT_MS - RESPONSE_MARGIN_MS - elapsed(session);

/** Resolves when the signal aborts. It never rejects. */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * Waits for store work done before synthesis, but no longer than the one clock all of that work
 * shares. Each call has its own limit; this keeps several slow ones in a row from using up the time
 * synthesis needs. Work that is still running when the clock runs out is left to finish by itself.
 */
async function duringSetup<T>(session: Session, work: Promise<T>): Promise<T> {
  work.catch(() => undefined);
  const late = whenAborted(session.setup.signal).then((): never => {
    throw new Error(`the store calls before synthesis passed their ${PRE_SYNTHESIS_BOUND_MS} ms`);
  });
  return Promise.race([work, late]);
}

interface Charge {
  plan: ChargePlan;
  month: string;
}

/**
 * Reads the month's document, fresh, and works out what this digest costs now. Two SIMPLE
 * operations, and the read is a free cache hit while the document has not changed. A document that
 * exists but cannot be read is an error here, never an empty month.
 */
async function planDigestCharge(
  session: Session,
  characters: number,
  mode: NarrationMode,
  voice: string = voiceOf(session.config),
): Promise<Charge> {
  const { id, config, blob, deps } = session;
  const now = deps.now();
  const month = usageMonth(new Date(now));
  const stored = await readFresh(blob, usageKey(month));
  const plan = planCharge({
    state: parseState(stored?.text ?? null, month),
    digest: id,
    characters,
    voice,
    mode,
    now,
    monthlyChars: config.monthlyChars ?? DEFAULT_MONTHLY_CHARS,
    dailyCap: NARRATE_DAILY_CAP,
  });
  return { plan, month };
}

/** The answer to send when the plan is a refusal, or null when narrating may go ahead. */
function refusalOf(session: Session, plan: ChargePlan): NarrateResult | null {
  if (plan.kind === "daily_cap") return dailyCap(plan.retryAfterSeconds);
  if (plan.kind === "monthly_budget") {
    session.log(`${session.label}: refused. ${describeRefusal(plan.refusal)}`);
    return monthlyBudget;
  }
  return null;
}

/**
 * Writes the charge, if there is one, and only returns once it is stored: nothing is synthesized
 * for a digest whose charge is not on record. One ADVANCED operation, once per digest per month in
 * the ordinary case.
 */
async function writeCharge(session: Session, charge: Charge): Promise<void> {
  if (charge.plan.kind !== "charge") return;
  await session.blob.put(usageKey(charge.month), serializeState(charge.plan.next), JSON_FILE);
  session.log(
    `${session.label}: charged ${charge.plan.added} characters to ${charge.month} for the digest`,
  );
}

/**
 * Called when an attempt reached Speechify and then failed, whatever the reason. The digest's
 * charge paid for that attempt; the retry will have Speechify read the same text again, so the
 * attempt's characters are added now, where there is a request to do it in. One ADVANCED operation,
 * on failures only. It gets what time is left and no more; when there is none, the log says what
 * went uncounted.
 */
async function chargeFailedAttempt(session: Session, characters: number): Promise<void> {
  const { id, label, blob, deps, log, secrets } = session;
  const budget = Math.min(2 * BLOB_CALL_TIMEOUT_MS, timeLeft(session));
  if (budget < MIN_UPLOAD_MS) {
    log(`${label}: no time left to count ${characters} characters of a failed attempt`);
    return;
  }
  const clock = deps.startDeadline(budget, "repeat");
  const counted = (async () => {
    const now = deps.now();
    const month = usageMonth(new Date(now));
    const stored = await readFresh(blob, usageKey(month));
    const next = addRepeat(parseState(stored?.text ?? null, month), id, characters, now);
    await blob.put(usageKey(month), serializeState(next), JSON_FILE);
    log(`${label}: counted ${characters} more characters for the attempt that failed`);
  })().catch((error: unknown) => {
    log(
      `${label}: ${characters} characters of a failed attempt could not be counted: ` +
        describeError(error, secrets),
    );
  });
  try {
    await Promise.race([counted, whenAborted(clock.signal)]);
  } finally {
    clock.cancel();
  }
}

/**
 * Runs the paid part of a request. Whatever way it fails, if a request went out to Speechify the
 * attempt's characters are counted before the answer is sent.
 */
async function attempt(
  session: Session,
  characters: number,
  work: () => Promise<NarrateResult>,
): Promise<NarrateResult> {
  let result: NarrateResult;
  try {
    result = await work();
  } catch (error) {
    session.log(`${session.label}: failed: ${describeError(error, session.secrets)}`);
    result = unavailable;
  }
  if (result.status !== 200 && session.reachedSpeechify) {
    await chargeFailedAttempt(session, characters);
  }
  return result;
}

/** Ties every Speechify request to the deadline as well as to the client's own timeout. */
function boundBy(session: Session, deadline: AbortSignal): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    session.reachedSpeechify = true;
    return session.deps.fetch(url, { ...init, signal });
  };
}

/** The wait before a retry must end with the deadline too. */
function endWith<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => reject(deadline.reason);
    if (deadline.aborted) {
      stop();
      return;
    }
    deadline.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => deadline.removeEventListener("abort", stop));
  });
}

interface Synthesis {
  audio: Uint8Array;
  marks: SpeechMark[];
  durationMs: number;
  billableCharacters: number;
}

async function synthesize(
  speech: SpeechSynthesizer,
  request: SynthesisRequest,
  log: (message: string) => void,
): Promise<Synthesis> {
  try {
    return await speech.synthesizeWithMarks(request);
  } catch (error) {
    if (!isMarksUnavailable(error)) throw error;
    // The engine's documented fallback: plain audio now, a timeline estimated from character share.
    log("speech marks are unavailable, using the plain stream and an estimated timeline");
    return { ...(await speech.synthesize(request)), marks: [] };
  }
}

interface Spoken extends Synthesis {
  synthesisMs: number;
}

/**
 * Has Speechify read `text`, under the one deadline. It returns the audio, or the answer to send
 * when there is none. The deadline's signal goes into every request, so when it passes the upstream
 * request is stopped, not left running.
 */
async function speak(
  session: Session,
  text: string,
  voice: string = voiceOf(session.config),
): Promise<Spoken | NarrateResult> {
  const { label, config, deps, log, secrets } = session;

  const budget = synthesisBudget(session);
  if (budget < MIN_SYNTHESIS_MS) {
    log(`${label}: ${elapsed(session)} ms were gone before synthesis could start, so it did not`);
    return unavailable;
  }
  const deadline = deps.startDeadline(budget, "synthesis");
  const speech = createSpeechifyClient({
    apiKey: config.speechifyKey,
    fetch: boundBy(session, deadline.signal),
    timeoutMs: budget,
    maxRetries: SPEECHIFY_RETRIES,
    maxRetryWaitMs: SPEECHIFY_MAX_RETRY_WAIT_MS,
    sleep: (milliseconds) => endWith(deps.delay(milliseconds), deadline.signal),
    now: () => new Date(deps.now()),
  });

  const startedAt = deps.now();
  try {
    const narration = await synthesize(speech, { text, voiceId: voice, model: DEFAULT_MODEL }, log);
    return { ...narration, synthesisMs: deps.now() - startedAt };
  } catch (error) {
    const spent = error instanceof SpeechifyError ? (error.partialCharacters ?? 0) : 0;
    const cost = spent > 0 ? `, after at least ${spent} characters were synthesized` : "";
    if (deadline.signal.aborted) {
      log(`${label}: synthesis passed its ${budget} ms deadline and was stopped${cost}`);
      return tookTooLong;
    }
    log(`${label}: synthesis failed${cost}: ${describeError(error, secrets)}`);
    return synthesisFailed;
  } finally {
    deadline.cancel();
  }
}

/**
 * Uploads audio or its timeline, trying again after a blip. Each attempt has its own limit, no
 * attempt starts that could not finish before the function has to answer, and the pause before a
 * retry is never longer than the time that is left, so giving up always happens in time to say so.
 */
async function putWithRetry(
  session: Session,
  pathname: string,
  body: Uint8Array | string,
  options: BlobWriteOptions,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const timeoutMs = Math.min(BLOB_UPLOAD_TIMEOUT_MS, timeLeft(session));
    if (timeoutMs < MIN_UPLOAD_MS) {
      throw new Error("there is no time left to upload before the function's limit");
    }
    try {
      const stored = await session.blob.put(pathname, body, { ...options, timeoutMs });
      if (!isHttps(stored.url)) throw new Error("the store returned a URL that is not https");
      return stored.url;
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS) throw error;
      const pause = Math.min(UPLOAD_RETRY_DELAY_MS * attempt, timeLeft(session) - MIN_UPLOAD_MS);
      // No room for a pause and another try: this failure is the last one.
      if (pause <= 0) throw error;
      session.log(
        `${session.label}: upload of ${pathname} failed on attempt ${attempt}, retrying: ` +
          describeError(error, session.secrets),
      );
      await session.deps.delay(pause);
    }
  }
}

/**
 * The paid part of a whole digest: synthesize, then the MP3 first, because it is what was paid for,
 * then the timeline, because audio without it cannot be shown.
 */
async function synthesizeAndStore(session: Session, script: Script): Promise<NarrateResult> {
  const { id, label, config, deps, log, secrets } = session;
  const voice = voiceOf(config);

  const narration = await speak(session, script.spoken.text);
  if ("status" in narration) return narration;
  const characters = narration.billableCharacters;

  let timeline: AudioTimeline;
  try {
    const resolved = resolveTimeline({
      digest: script.digest,
      spoken: script.spoken,
      marks: narration.marks,
      durationMs: narration.durationMs,
      voice,
      model: DEFAULT_MODEL,
    });
    timeline = resolved.timeline;
    if (resolved.degradedReason !== undefined) {
      log(`${label}: estimated timeline (${resolved.degradedReason})`);
    }
  } catch (error) {
    log(
      `${label}: no timeline could be built, ${characters} synthesized characters are lost: ` +
        describeError(error, secrets),
    );
    return synthesisFailed;
  }

  const uploadStartedAt = deps.now();
  let url: string;
  try {
    url = await putWithRetry(session, audioKey(id), narration.audio, {
      contentType: "audio/mpeg",
      cacheSeconds: AUDIO_CACHE_SECONDS,
    });
    await putWithRetry(
      session,
      timelineKey(id),
      `${JSON.stringify(timeline, null, 2)}\n`,
      JSON_FILE,
    );
  } catch (error) {
    log(
      `${label}: upload failed for good, ${characters} synthesized characters are lost: ` +
        describeError(error, secrets),
    );
    return storageFailed;
  }

  // The limits in functionLimits.mjs are set from these: synthesis against the deadline, and the
  // total less synthesis against the time kept back for everything else.
  log(
    `${label}: stored. ${characters} characters, synthesis ${narration.synthesisMs} ms, ` +
      `upload ${deps.now() - uploadStartedAt} ms, total ${elapsed(session)} ms, ` +
      `${timeline.timeline} timeline`,
  );
  return ready({ url, timeline });
}

/**
 * Takes the in-progress marker, or returns the answer to send when another request holds it.
 *
 * The store decides who gets it: `create` writes only if nothing is there, so of two requests that
 * arrive together exactly one is told yes.
 *
 * A marker older than a function can live was left by one that was stopped, and may be taken over,
 * by one request only. So the old marker is deleted on the condition that it is still the very one
 * that was read: a contender that read the same stale marker, but comes after another has already
 * replaced it, deletes nothing. Then the claim is made again, and the store again says yes to one.
 */
async function claimMarker(session: Session): Promise<NarrateResult | null> {
  const { id, blob, deps } = session;
  const key = markerKey(id);
  const body = `${JSON.stringify({ digest: id, started_at: new Date(deps.now()).toISOString() })}\n`;
  if (await blob.create(key, body, JSON_FILE)) return null;

  const now = deps.now();
  const marker = await blob.head(key);
  if (marker && now - marker.uploadedAt < MARKER_TTL_MS) {
    return inProgress(Math.max(1, Math.ceil((marker.uploadedAt + MARKER_TTL_MS - now) / 1000)));
  }
  if (marker) await blob.delIfUnchanged(marker);
  if (await blob.create(key, body, JSON_FILE)) return null;
  return inProgress(Math.ceil(MARKER_TTL_MS / 1000));
}

/**
 * Deletes the marker without letting the delete hold the answer back. The wait is shorter than the
 * time kept for answering, and a marker that is not cleared by then expires by itself.
 */
async function clearMarker(session: Session): Promise<void> {
  const { id, label, blob, deps, log, secrets } = session;
  const wait = deps.startDeadline(MARKER_CLEAR_WAIT_MS, "marker");
  const cleared = blob.del(markerKey(id)).catch((error: unknown) => {
    log(`${label}: the marker was left behind and will expire: ${describeError(error, secrets)}`);
  });
  try {
    await Promise.race([cleared, whenAborted(wait.signal)]);
  } finally {
    wait.cancel();
  }
}

/** POST /api/narrate without a segment: the whole digest as one file. */
async function narrateWhole(session: Session): Promise<NarrateResult> {
  const { id, label, blob, deps, log, secrets } = session;

  // An episode is read by two voices, turn by turn. There is no single file to make of it.
  if (isEpisodeId(id)) return notNarratable;

  const existing = await duringSetup(session, findNarration(blob, deps.digests, id));
  if (existing) return ready(existing);

  const script = await loadScript(deps.digests, id, log, secrets);
  if (!("spoken" in script)) return script;
  const characters = script.spoken.text.length;

  // The limits are checked before the marker is taken: a refusal costs simple operations only.
  const charge = await duringSetup(session, planDigestCharge(session, characters, "whole"));
  const refusal = refusalOf(session, charge.plan);
  if (refusal) return refusal;

  // Not under the shared clock: a claim that was given up on could still succeed, and would then
  // leave a marker nobody clears. It has its own two or three bounded calls.
  const held = await claimMarker(session);
  if (held) return held;
  try {
    // Another request may have finished this digest between the first look and the marker. Now
    // that the marker is ours nobody else can, so this second look is the one that counts.
    const finished = await duringSetup(session, findNarration(blob, deps.digests, id));
    if (finished) return ready(finished);

    await duringSetup(session, writeCharge(session, charge));
    session.setup.cancel();
    return await attempt(session, characters, () => synthesizeAndStore(session, script));
  } catch (error) {
    log(`${label}: failed: ${describeError(error, secrets)}`);
    return unavailable;
  } finally {
    // Cleared on every way out, so a failure never blocks the next attempt.
    await clearMarker(session);
  }
}

/**
 * POST /api/narrate with a segment: one stretch of the digest, narrated and stored as its own file.
 *
 * There is no marker and no manifest here. The file's name can be worked out from the digest (see
 * narrateSegments.ts), so whether it exists is one head, and two requests for different segments of
 * one digest cannot undo each other: each adds its own file. If the same segment is asked for twice
 * at once, both may be synthesized and the second upload replaces the first; the digest is charged
 * once either way. The page sends one segment at a time.
 */
async function narrateSegment(session: Session, key: string): Promise<NarrateResult> {
  const { id, blob } = session;

  // From the bundle only: an unknown digest or segment is refused before any store or speech call.
  const script = await loadSegmentScript(session);
  if ("status" in script) return script;
  const segment = script.segments.find((candidate) => candidate.key === key);
  if (!segment) return segmentNotFound;
  const described = {
    key: segment.key,
    item_id: segment.itemId,
    characters: segment.text.length,
  };

  const voice = script.voiceFor(segment.key);
  const path = segmentPath(id, key, segmentHash(segment.text, voice, DEFAULT_MODEL));

  // Side by side, because the first segment is the one a listener is waiting to hear: is it
  // already narrated, and what does the digest still owe. Simple operations only.
  const owed = planDigestCharge(session, script.characters, "segments", script.chargeVoice);
  // Looked at below. Until then a failure must not count as unhandled.
  owed.catch(() => undefined);

  // Already narrated: returned as it is. No characters are spent and nothing is written, and it
  // does not matter what state the month's document is in.
  const existing = segmentAudio(await duringSetup(session, blob.head(path)), segment.text.length);
  if (existing)
    return { status: 200, body: { status: 200, segment: { ...described, audio: existing } } };

  const charge = await duringSetup(session, owed);
  const refusal = refusalOf(session, charge.plan);
  if (refusal) return refusal;

  // The digest's whole text is charged here, once, before anything is synthesized. Every later
  // segment of this digest finds the charge and skips this write.
  await duringSetup(session, writeCharge(session, charge));
  session.setup.cancel();

  return attempt(session, segment.text.length, () =>
    synthesizeSegment(session, path, segment, described, voice),
  );
}

/** What a request for one segment needs to know about the thing it narrates. */
interface SegmentScript {
  segments: SpokenSegment[];
  /** The length of the whole narration, which is what the digest or episode is charged. */
  characters: number;
  /** The voice that reads a segment. */
  voiceFor(key: string): string;
  /** The voice the charge is recorded for. A change of it makes every file again. */
  chargeVoice: string;
}

/** The briefing or the episode behind the request, ready to narrate a segment of, or the answer to send. */
async function loadSegmentScript(session: Session): Promise<SegmentScript | NarrateResult> {
  const { id, config, deps, log, secrets } = session;
  if (!isEpisodeId(id)) {
    const script = await loadScript(deps.digests, id, log, secrets);
    if (!("spoken" in script)) return script;
    const voice = voiceOf(config);
    return {
      segments: script.segments,
      characters: script.spoken.text.length,
      voiceFor: () => voice,
      chargeVoice: voice,
    };
  }
  const script = await loadEpisodeScript(deps.episodes, id, log, secrets, deps.liveEpisodes);
  if (!("episode" in script)) return script;
  const asked = script.episode.request;
  const first = asked.voice_id ?? voiceOf(config);
  const second = asked.voice_id_b ?? config.voiceIdB ?? first;
  return {
    segments: script.segments,
    characters: script.characters,
    voiceFor: (key) => (script.speakers.get(key) === "b" ? second : first),
    // Two voices are charged as the pair, so changing either one pays again.
    chargeVoice: second === first ? first : `${first}+${second}`,
  };
}

/** The paid part of one segment: synthesize it and store the file. */
async function synthesizeSegment(
  session: Session,
  path: string,
  segment: SpokenSegment,
  described: Omit<NarrationSegment, "audio">,
  voice: string,
): Promise<NarrateResult> {
  const { label, deps, log, secrets } = session;

  // The duration comes from the stream's own done event. The word marks are kept beside the audio.
  const narration = await speak(session, segment.text, voice);
  if ("status" in narration) return narration;
  const characters = narration.billableCharacters;

  const uploadStartedAt = deps.now();
  // The word marks go up beside the audio, not after it: the listener waits for both. Their put
  // never throws and has its own bound, so it cannot delay or fail the audio that was paid for.
  const marksStored = storeSegmentMarks(session, path, segment.text, narration.marks);
  let url: string;
  try {
    url = await putWithRetry(session, path, narration.audio, {
      contentType: "audio/mpeg",
      cacheSeconds: SEGMENT_CACHE_SECONDS,
    });
  } catch (error) {
    log(
      `${label}: upload failed for good, ${characters} synthesized characters are lost: ` +
        describeError(error, secrets),
    );
    await marksStored;
    return storageFailed;
  }

  await marksStored;

  log(
    `${label}: stored. ${characters} characters, synthesis ${narration.synthesisMs} ms, ` +
      `upload ${deps.now() - uploadStartedAt} ms, total ${elapsed(session)} ms`,
  );
  return {
    status: 200,
    body: {
      status: 200,
      segment: {
        ...described,
        audio: {
          url,
          duration_ms: Math.max(1, Math.round(narration.durationMs)),
          confirmed: true,
        },
      },
    },
  };
}

/**
 * Keeps a segment's word marks beside its audio, so the transcript can light the word being said.
 * One put, once, only when there are marks, and only with time to spare. The audio is what was
 * paid for and is already stored: a failure here is logged and the page estimates instead.
 */
async function storeSegmentMarks(
  session: Session,
  audioPath: string,
  text: string,
  marks: readonly SpeechMark[],
): Promise<void> {
  const { label, log, secrets } = session;
  const words = deriveSegmentMarks(text, marks);
  if (words.length === 0) return;
  const timeoutMs = Math.min(BLOB_UPLOAD_TIMEOUT_MS, timeLeft(session));
  if (timeoutMs < MIN_UPLOAD_MS) {
    log(`${label}: no time left to store the word marks, the page will estimate them`);
    return;
  }
  try {
    const body: SegmentMarks = { words };
    await session.blob.put(segmentMarksPath(audioPath), JSON.stringify(body), {
      contentType: "application/json",
      cacheSeconds: SEGMENT_CACHE_SECONDS,
      timeoutMs,
    });
  } catch (error) {
    log(`${label}: the word marks were not stored: ${describeError(error, secrets)}`);
  }
}

/** POST /api/narrate. */
export async function handleNarrate(
  input: NarrateInput,
  deps: NarrateDeps,
): Promise<NarrateResult> {
  const startedAt = deps.now();
  const log = deps.log ?? (() => {});
  const config = readNarrateConfig(deps.env, input.requestOidcToken);
  if (!config) return unavailable;

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const request = parseNarrateRequest(input.bodyText);
  if (request === null) return invalid;

  // The shared burst cap (D150), taken only by a request that passed the checks above, and before
  // the store is opened: a flood past it costs no Blob read.
  const burstWait = (await deps.burst?.()) ?? 0;
  if (burstWait > 0) return cooldownRefusal(burstWait);

  // A briefing is read in the voice its schedule names; the body of the request never picks one.
  const scheduled = await scheduledVoice(deps.digests, request.digest);

  const session: Session = {
    id: request.digest,
    label:
      request.segment === undefined
        ? `narrate ${request.digest}`
        : `narrate ${request.digest} ${request.segment}`,
    config: scheduled ? { ...config, voiceId: scheduled } : config,
    blob: deps.openBlob(config.blob),
    deps,
    secrets: narrateSecretsOf(config),
    log,
    startedAt,
    setup: deps.startDeadline(PRE_SYNTHESIS_BOUND_MS, "setup"),
    reachedSpeechify: false,
  };

  try {
    return request.segment === undefined
      ? await narrateWhole(session)
      : await narrateSegment(session, request.segment);
  } catch (error) {
    // A store that cannot be reached, a counter that cannot be read: "try again later".
    log(`${session.label}: failed: ${describeError(error, session.secrets)}`);
    return unavailable;
  } finally {
    session.setup.cancel();
  }
}
