import { AudioTimeline, type Digest, DigestId, parseDigestFile } from "@dispatch/core";
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
import type {
  NarrateLookupResponse,
  NarrateResponse,
  NarrateSegmentResponse,
  NarrationSegment,
} from "../types/contracts";
import {
  type BlobEntry,
  type BlobWriteOptions,
  type NarrateBlobStore,
  readFresh,
} from "./blobStore";
import {
  type BlobCredentials,
  blobSecretsOf,
  MS_PER_CHARACTER,
  type NarrateConfig,
  narrateSecretsOf,
  readBlobCredentials,
  readNarrateConfig,
  readVoiceId,
  type ServerEnv,
} from "./config";
import {
  BLOB_UPLOAD_TIMEOUT_MS,
  FUNCTION_MAX_DURATION_S,
  NARRATE_OVERHEAD_MS,
  SYNTHESIS_DEADLINE_MS,
} from "./functionLimits.mjs";
import {
  isSameOrigin,
  MAX_BODY_CHARS,
  MAX_PASSPHRASE_CHARS,
  WRONG_PASSPHRASE_DELAY_MS,
} from "./generate";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";
import { NARRATE_DAILY_CAP } from "./limits";
import {
  describeSegments,
  digestPrefix,
  SEGMENT_KEY,
  segmentAudio,
  segmentHash,
  segmentPath,
} from "./narrateSegments";
import {
  type ChargePlan,
  parseState,
  planCharge,
  serializeState,
  usageKey,
} from "./narrationState";
import { describeError } from "./redact";

/**
 * /api/narrate: narration made when a listener presses Play, not ahead of time.
 *
 * GET says what narration a digest has: the whole digest as one file, if it was narrated that way,
 * and every segment (the intro, each story, an outro) with its file once it exists. It needs no
 * passphrase and spends nothing. POST checks the passphrase and the limits and has Speechify read
 * either one segment or the whole digest, stores the result in Blob, and returns it.
 *
 * The function keeps no state of its own. Everything it knows is in the Blob store: the audio, the
 * whole-digest timeline, a marker while a whole digest is being narrated, and one document a month
 * with the characters charged and the digests they were charged for (narrationState.ts). Everything
 * with a side effect is a parameter (fetch, the clock, the deadline, the store, the digest files),
 * so the whole flow is tested with fakes and no network.
 *
 * What each call costs the store. ADVANCED operations (put, list) are the scarce ones, 2,000 a
 * month; SIMPLE ones (head, an uncached read) have 10,000; a delete and a cached read are free.
 *
 *   GET                              1 advanced  the listing of the digest's folder
 *                                    +2 simple   only when the digest has a whole-digest MP3, for
 *                                                its timeline
 *   POST segment, first of a digest  2 advanced  the month's charge, then the segment
 *                                    3 simple    the segment's head; the charge document's head and
 *                                                read
 *   POST segment, later ones         1 advanced  the segment
 *                                    2 simple    as above, but the charge document has not changed,
 *                                                so its read is a cache hit and free
 *   POST segment, already narrated   0 advanced
 *   POST whole digest                4 advanced  the marker, the charge, the MP3, the timeline
 *                                                (3 when the digest is already charged)
 *
 * A digest of 19 segments narrated story by story is therefore 1 + 2 + 18 = 21 advanced operations,
 * lookup included. narrate.test.ts counts them and fails above 22.
 */

export const audioKey = (id: string): string => `audio/${id}.mp3`;
export const timelineKey = (id: string): string => `timeline/${id}.json`;
export const markerKey = (id: string): string => `state/narrating-${id}.json`;

/**
 * The lifetime the engine gives a narration. The URL is fixed per digest, so a long cache would let a
 * browser pair an old MP3 with a new timeline.
 */
const AUDIO_CACHE_SECONDS = 60 * 60;
/**
 * A segment's name holds the hash of its text and voice, so the words behind a URL never change and
 * the file can be kept for a month.
 */
const SEGMENT_CACHE_SECONDS = 30 * 24 * 60 * 60;
/** The timeline and the bookkeeping files must be current. 60 seconds is the shortest Blob allows. */
const JSON_CACHE_SECONDS = 60;
const JSON_FILE = { contentType: "application/json", cacheSeconds: JSON_CACHE_SECONDS } as const;

/** A paid narration should survive a blip in the store. */
export const UPLOAD_ATTEMPTS = 3;
export const UPLOAD_RETRY_DELAY_MS = 500;

const FUNCTION_LIMIT_MS = FUNCTION_MAX_DURATION_S * 1000;
/** The answer still has to be sent after the last write. */
const RESPONSE_MARGIN_MS = 1000;
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
export const MARKER_CLEAR_WAIT_MS = 1500;

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
  verifyPassphrase: (passphrase: string, storedHash: string) => Promise<boolean>;
  openBlob: (credentials: BlobCredentials) => NarrateBlobStore;
  digests: DigestSource;
  startDeadline: (milliseconds: number) => Deadline;
  log?: (message: string) => void;
}

export type LookupDeps = Pick<NarrateDeps, "env" | "openBlob" | "digests" | "log">;

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
  requestOidcToken?: () => string | null;
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

/** A digest id from a query parameter or a body field, or null when it is not one. */
export function parseDigestId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_DIGEST_ID_CHARS) return null;
  const parsed = DigestId.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface ParsedNarrateRequest {
  digest: string;
  passphrase: string;
  /** Present when the request is for one segment. */
  segment?: string;
}

/**
 * Pulls the digest id, the passphrase and the optional segment key out of a JSON body, or null when
 * it is not that shape.
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
  const { digest, passphrase, segment } = parsed as {
    digest?: unknown;
    passphrase?: unknown;
    segment?: unknown;
  };
  if (typeof passphrase !== "string") return null;
  if (passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_CHARS) return null;
  const id = parseDigestId(digest);
  if (id === null) return null;
  if (segment === undefined) return { digest: id, passphrase };
  // A key that is sent has to be one. Anything else must not fall through to the whole digest, which
  // costs far more than the caller asked for.
  if (typeof segment !== "string" || !SEGMENT_KEY.test(segment)) return null;
  return { digest: id, passphrase, segment };
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
 * A whole-digest narration exists when the store has the MP3 and a timeline for it. The timeline is
 * the one this function stored, or, for a digest the audio workflow narrated before narrate on Play,
 * the one committed next to the digest. `audio` is the MP3's entry, from a head or from a listing.
 */
async function wholeNarration(
  blob: NarrateBlobStore,
  digests: DigestSource,
  id: string,
  audio: BlobEntry | null | undefined,
): Promise<Narration | null> {
  if (!audio || !isHttps(audio.url)) return null;
  const stored = await readFresh(blob, timelineKey(id));
  const timeline =
    timelineFor(parseJson(stored?.text), id) ?? timelineFor(await digests.readTimeline(id), id);
  return timeline ? { url: audio.url, timeline } : null;
}

async function findNarration(
  blob: NarrateBlobStore,
  digests: DigestSource,
  id: string,
): Promise<Narration | null> {
  return wholeNarration(blob, digests, id, await blob.head(audioKey(id)));
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

/** GET /api/narrate?digest=<id>. */
export async function handleNarrationLookup(
  input: LookupInput,
  deps: LookupDeps,
): Promise<NarrateResult> {
  const log = deps.log ?? (() => {});
  // The id comes first: a request without one (the static build makes one) reads no configuration.
  const id = parseDigestId(input.digest);
  if (id === null) return invalid;

  // Anyone can call this, and every store call is metered. An id that names no digest in this
  // deployment is answered from the bundle, so only real digests can cost one.
  let script: Script | NarrateResult;
  try {
    script = await loadScript(deps.digests, id, log, []);
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, [])}`);
    return unavailable;
  }
  if (!("spoken" in script)) return script;

  const voice = readVoiceId(deps.env);
  if (voice === null) return unavailable;
  const credentials = readBlobCredentials(deps.env, input.requestOidcToken);
  if (!credentials) return unavailable;

  try {
    const blob = deps.openBlob(credentials);
    // One listing is the whole answer: the digest's own MP3 and every segment file sit under this
    // prefix. A segment's duration is worked out from its size (see narrateSegments.ts). Only a
    // digest that was narrated as one file costs more, two simple operations for its timeline.
    const listing = await blob.list(digestPrefix(id));
    const whole = await wholeNarration(
      blob,
      deps.digests,
      id,
      listing.find((entry) => entry.pathname === audioKey(id)),
    );
    return {
      status: 200,
      body: {
        status: 200,
        ...(whole ? narrationFields(whole) : { audio: null, timeline: null }),
        segments: describeSegments(
          script.segments,
          listing,
          id,
          voice ?? DEFAULT_VOICE_ID,
          DEFAULT_MODEL,
        ),
        ms_per_character: MS_PER_CHARACTER,
      },
    };
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, blobSecretsOf(credentials))}`);
    return unavailable;
  }
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
}

const voiceOf = (config: NarrateConfig): string => config.voiceId ?? DEFAULT_VOICE_ID;
const elapsed = (session: Session): number => session.deps.now() - session.startedAt;

/**
 * How long Speechify may take from now. It is counted from the start of the request, not from the
 * start of synthesis, and it always ends NARRATE_OVERHEAD_MS before the function's limit: time
 * already spent on the passphrase and the store comes out of the synthesis, never out of the time
 * kept for storing what was paid for.
 */
function synthesisBudget(session: Session): number {
  return Math.min(
    SYNTHESIS_DEADLINE_MS,
    FUNCTION_LIMIT_MS - NARRATE_OVERHEAD_MS - elapsed(session),
  );
}

/** How long is left before the function has to answer. */
const timeLeft = (session: Session): number =>
  FUNCTION_LIMIT_MS - RESPONSE_MARGIN_MS - elapsed(session);

interface Charge {
  plan: ChargePlan;
  month: string;
}

/**
 * Reads the month's document, fresh, and works out what this digest costs now. Two SIMPLE
 * operations, and the read is a free cache hit while the document has not changed.
 */
async function planDigestCharge(session: Session, characters: number): Promise<Charge> {
  const { id, config, blob, deps } = session;
  const now = deps.now();
  const month = usageMonth(new Date(now));
  const stored = await readFresh(blob, usageKey(month));
  const plan = planCharge({
    state: parseState(stored?.text ?? null, month),
    digest: id,
    characters,
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
 * for a digest whose charge is not on record. One ADVANCED operation, once per digest per month.
 */
async function writeCharge(session: Session, charge: Charge): Promise<void> {
  if (charge.plan.kind !== "charge") return;
  await session.blob.put(usageKey(charge.month), serializeState(charge.plan.next), JSON_FILE);
  session.log(
    `${session.label}: charged ${charge.plan.added} characters to ${charge.month} for the digest`,
  );
}

/** Ties every Speechify request to the deadline as well as to the client's own timeout. */
function boundBy(doFetch: FetchLike, deadline: AbortSignal): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return doFetch(url, { ...init, signal });
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

/** Resolves when the signal aborts. It never rejects. */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
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
 * request is stopped, not left running. The digest was charged in full before this was called, so a
 * failure here is already covered by the counter.
 */
async function speak(session: Session, text: string): Promise<Spoken | NarrateResult> {
  const { label, config, deps, log, secrets } = session;

  const budget = synthesisBudget(session);
  if (budget < MIN_SYNTHESIS_MS) {
    log(`${label}: ${elapsed(session)} ms were gone before synthesis could start, so it did not`);
    return unavailable;
  }
  const deadline = deps.startDeadline(budget);
  const speech = createSpeechifyClient({
    apiKey: config.speechifyKey,
    fetch: boundBy(deps.fetch, deadline.signal),
    timeoutMs: budget,
    maxRetries: SPEECHIFY_RETRIES,
    maxRetryWaitMs: SPEECHIFY_MAX_RETRY_WAIT_MS,
    sleep: (milliseconds) => endWith(deps.delay(milliseconds), deadline.signal),
    now: () => new Date(deps.now()),
  });

  const startedAt = deps.now();
  try {
    const narration = await synthesize(
      speech,
      { text, voiceId: voiceOf(config), model: DEFAULT_MODEL },
      log,
    );
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
 * Uploads audio or its timeline, trying again after a blip. Each attempt has its own limit, and no
 * attempt starts that could not finish before the function has to answer.
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
      session.log(
        `${session.label}: upload of ${pathname} failed on attempt ${attempt}, retrying: ` +
          describeError(error, session.secrets),
      );
      await session.deps.delay(UPLOAD_RETRY_DELAY_MS * attempt);
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
 * arrive together exactly one is told yes. A marker that is there but older than a function can
 * live was left by one that was stopped; it is deleted and the claim made again, which again only
 * one request can win.
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
  await blob.del(key);
  if (await blob.create(key, body, JSON_FILE)) return null;
  return inProgress(Math.ceil(MARKER_TTL_MS / 1000));
}

/**
 * Deletes the marker without letting the delete hold the answer back. The store gives every call
 * its own time limit; this wait is shorter still, and a marker that is not cleared by then expires
 * by itself.
 */
async function clearMarker(session: Session): Promise<void> {
  const { id, label, blob, deps, log, secrets } = session;
  const wait = deps.startDeadline(MARKER_CLEAR_WAIT_MS);
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

  const existing = await findNarration(blob, deps.digests, id);
  if (existing) return ready(existing);

  const script = await loadScript(deps.digests, id, log, secrets);
  if (!("spoken" in script)) return script;

  // The limits are checked before the marker is taken: a refusal costs simple operations only.
  const charge = await planDigestCharge(session, script.spoken.text.length);
  const refusal = refusalOf(session, charge.plan);
  if (refusal) return refusal;

  const held = await claimMarker(session);
  if (held) return held;
  try {
    // Another request may have finished this digest between the first look and the marker. Now
    // that the marker is ours nobody else can, so this second look is the one that counts.
    const finished = await findNarration(blob, deps.digests, id);
    if (finished) return ready(finished);

    await writeCharge(session, charge);
    return await synthesizeAndStore(session, script);
  } catch (error) {
    log(`${label}: failed: ${describeError(error, secrets)}`);
    return unavailable;
  } finally {
    // Cleared on every way out, so a failure never blocks the next attempt.
    await clearMarker(session);
  }
}

function segmentReady(segment: NarrationSegment): NarrateResult {
  // Only called with a narrated segment; the check keeps the type honest without a cast.
  if (segment.audio === null) return unavailable;
  return { status: 200, body: { status: 200, segment: { ...segment, audio: segment.audio } } };
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
  const { id, label, config, blob, deps, log, secrets } = session;

  // From the bundle only: an unknown digest or segment is refused before any store or speech call.
  const script = await loadScript(deps.digests, id, log, secrets);
  if (!("spoken" in script)) return script;
  const segment = script.segments.find((candidate) => candidate.key === key);
  if (!segment) return segmentNotFound;
  const described = {
    key: segment.key,
    item_id: segment.itemId,
    characters: segment.text.length,
  };

  const path = segmentPath(id, key, segmentHash(segment.text, voiceOf(config), DEFAULT_MODEL));

  // Side by side, because the first segment is the one a listener is waiting to hear: is it
  // already narrated, and what does the digest still owe. Simple operations only.
  const owed = planDigestCharge(session, script.spoken.text.length);
  // Looked at below. Until then a failure must not count as unhandled.
  owed.catch(() => undefined);

  // Already narrated: returned as it is. Nothing is spent and nothing is written, and it does not
  // matter what state the month's document is in.
  const existing = segmentAudio(await blob.head(path), segment.text.length);
  if (existing) return segmentReady({ ...described, audio: existing });

  const charge = await owed;
  const refusal = refusalOf(session, charge.plan);
  if (refusal) return refusal;

  // The digest's whole text is charged here, once, before anything is synthesized. Every later
  // segment of this digest finds the charge and skips this write.
  await writeCharge(session, charge);

  // The duration comes from the stream's own done event. Word marks are not used for a segment.
  const narration = await speak(session, segment.text);
  if ("status" in narration) return narration;
  const characters = narration.billableCharacters;

  const uploadStartedAt = deps.now();
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
    return storageFailed;
  }

  log(
    `${label}: stored. ${characters} characters, synthesis ${narration.synthesisMs} ms, ` +
      `upload ${deps.now() - uploadStartedAt} ms, total ${elapsed(session)} ms`,
  );
  return segmentReady({
    ...described,
    audio: { url, duration_ms: Math.max(1, Math.round(narration.durationMs)) },
  });
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

  const isValid = await deps.verifyPassphrase(request.passphrase, config.passphraseHash);
  if (!isValid) {
    await deps.delay(WRONG_PASSPHRASE_DELAY_MS);
    return { status: 401, body: { status: 401, error: "wrong_passphrase" } };
  }

  const session: Session = {
    id: request.digest,
    label:
      request.segment === undefined
        ? `narrate ${request.digest}`
        : `narrate ${request.digest} ${request.segment}`,
    config,
    blob: deps.openBlob(config.blob),
    deps,
    secrets: narrateSecretsOf(config),
    log,
    startedAt,
  };

  try {
    return request.segment === undefined
      ? await narrateWhole(session)
      : await narrateSegment(session, request.segment);
  } catch (error) {
    // A store that cannot be reached, a counter that cannot be read: "try again later".
    log(`${session.label}: failed: ${describeError(error, session.secrets)}`);
    return unavailable;
  }
}
