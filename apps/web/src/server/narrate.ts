import { AudioTimeline, type Digest, DigestId, parseDigestFile, UsageFile } from "@dispatch/core";
import {
  addUsage,
  buildSpokenText,
  checkBudget,
  createSpeechifyClient,
  DEFAULT_MODEL,
  DEFAULT_MONTHLY_CHARS,
  DEFAULT_VOICE_ID,
  describeRefusal,
  emptyUsage,
  isMarksUnavailable,
  resolveTimeline,
  SpeechifyError,
  type SpeechMark,
  type SpeechSynthesizer,
  type SpokenSegment,
  type SpokenText,
  type SynthesisRequest,
  spokenSegments,
  usageMonth,
} from "@dispatch/engine/audio";
import type {
  NarrateLookupResponse,
  NarrateResponse,
  NarrateSegmentResponse,
  NarrationSegment,
} from "../types/contracts";
import type { BlobEntry, NarrateBlobStore } from "./blobStore";
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
import { FUNCTION_MAX_DURATION_S, SYNTHESIS_DEADLINE_MS } from "./functionLimits.mjs";
import {
  isSameOrigin,
  MAX_BODY_CHARS,
  MAX_PASSPHRASE_CHARS,
  WRONG_PASSPHRASE_DELAY_MS,
} from "./generate";
import type { FetchLike } from "./github";
import type { ApiResult } from "./http";
import { evaluateDailyCap } from "./limits";
import {
  describeSegments,
  digestPrefix,
  SEGMENT_KEY,
  SLOT_PREFIX,
  segmentHash,
  segmentPath,
  slotKey,
} from "./narrateSegments";
import { describeError } from "./redact";

/**
 * /api/narrate: narration made when a listener presses Play, not ahead of time.
 *
 * GET says what narration a digest has: the whole digest as one file, if it was narrated that way,
 * and every segment (the intro, each story, an outro) with its file once it exists. It needs no
 * passphrase and spends nothing. POST checks the passphrase and the limits and has Speechify read
 * either one segment or the whole digest, stores the result in Blob, and returns it.
 *
 * The function keeps no state of its own. Everything it knows is in the Blob store: the audio (the
 * listing of segment files is the record of which segments exist), the whole-digest timeline, a
 * marker while a whole digest is being narrated, a slot per digest for the daily cap, and the
 * month's character count. Everything with a side effect is a parameter (fetch, the clock, the
 * deadline, the store, the digest files), so the whole flow is tested with fakes and no network.
 */

export const audioKey = (id: string): string => `audio/${id}.mp3`;
export const timelineKey = (id: string): string => `timeline/${id}.json`;
export const markerKey = (id: string): string => `state/narrating-${id}.json`;
/** One counter per Stockholm month, YYYY-MM. */
export const usageKey = (month: string): string => `state/usage-${month}.json`;

/**
 * The lifetime the engine gives a narration. The URL is fixed per digest, so a long cache would let a
 * browser pair an old MP3 with a new timeline.
 */
const AUDIO_CACHE_SECONDS = 60 * 60;
/**
 * A segment's name holds the hash of its text and its duration, so the file behind a URL never
 * changes and can be kept for a month.
 */
const SEGMENT_CACHE_SECONDS = 30 * 24 * 60 * 60;
/** The timeline and the bookkeeping files must be current. 60 seconds is the shortest Blob allows. */
const JSON_CACHE_SECONDS = 60;

/** A paid narration should survive a blip in the store. */
export const UPLOAD_ATTEMPTS = 3;
export const UPLOAD_RETRY_DELAY_MS = 500;

/**
 * A marker older than the longest a function can live was left by one that was stopped. The slack
 * covers the difference between the store's clock and the function's.
 */
export const MARKER_TTL_MS = FUNCTION_MAX_DURATION_S * 1000 + 30_000;

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

/** The synthesis clock: a signal that aborts when time is up, and a way to stop the clock. */
export interface Deadline {
  signal: AbortSignal;
  cancel(): void;
}

/** The real clock. The reason is a TimeoutError, which the Speechify client reports as a timeout. */
export function startDeadline(milliseconds: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The synthesis deadline passed", "TimeoutError"));
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

function parseJson(text: string | null): unknown {
  if (text === null) return null;
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
  const timeline =
    timelineFor(parseJson(await blob.readText(timelineKey(id))), id) ??
    timelineFor(await digests.readTimeline(id), id);
  return timeline ? { url: audio.url, timeline } : null;
}

async function findNarration(
  blob: NarrateBlobStore,
  digests: DigestSource,
  id: string,
): Promise<Narration | null> {
  return wholeNarration(blob, digests, id, await blob.head(audioKey(id)));
}

interface DigestSegments {
  digest: Digest;
  segments: SpokenSegment[];
}

/**
 * The digest and its segments, read from the bundle, or the answer to send when there are none.
 * It touches neither the store nor Speechify, so a request for something that does not exist is
 * refused before it can cost anything.
 */
async function loadSegments(
  digests: DigestSource,
  id: string,
  log: (message: string) => void,
  secrets: readonly string[],
): Promise<DigestSegments | NarrateResult> {
  const text = await digests.readDigest(id);
  if (text === null) return digestNotFound;
  try {
    const digest = parseDigestFile(text);
    if (digest.id !== id) throw new Error(`the file holds digest ${digest.id}`);
    return { digest, segments: spokenSegments(digest) };
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
  let loaded: DigestSegments | NarrateResult;
  try {
    loaded = await loadSegments(deps.digests, id, log, []);
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, [])}`);
    return unavailable;
  }
  if (!("segments" in loaded)) return loaded;

  const voice = readVoiceId(deps.env);
  if (voice === null) return unavailable;
  const credentials = readBlobCredentials(deps.env, input.requestOidcToken);
  if (!credentials) return unavailable;

  try {
    const blob = deps.openBlob(credentials);
    // One listing is the whole answer: the digest's own MP3 and every segment file sit under this
    // prefix, and a segment's name says which segment it is and how long it plays. Only a digest
    // that was narrated as one file costs a second call, for that file's timeline.
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
          loaded.segments,
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

async function readUsage(blob: NarrateBlobStore, month: string): Promise<UsageFile> {
  const text = await blob.readText(usageKey(month));
  if (text === null) return emptyUsage(month);
  // A counter that cannot be read must not pass for zero: that would switch the budget off.
  const parsed = UsageFile.safeParse(parseJson(text));
  if (!parsed.success || parsed.data.speechify.month !== month) {
    throw new Error(`${usageKey(month)} is not a valid usage counter`);
  }
  return parsed.data;
}

/**
 * Read, add, write. Unlike the segment files, this counter is a single object, so two requests that
 * finish together can lose one of the two counts. That is accepted: the page narrates one segment at
 * a time, and the budget stops at 90 percent of the allowance, which leaves room for a lost count.
 * The read is repeated here, right before the write, to keep that window as short as it can be.
 */
async function recordUsage(blob: NarrateBlobStore, now: Date, characters: number): Promise<void> {
  const month = usageMonth(now);
  const next = addUsage(await readUsage(blob, month), now, characters);
  await blob.put(usageKey(month), `${JSON.stringify(next, null, 2)}\n`, {
    contentType: "application/json",
    cacheSeconds: JSON_CACHE_SECONDS,
  });
}

/**
 * The daily cap counts digests, not requests. A digest takes a slot the first time anything is
 * narrated for it, whole or one segment, and keeps it: every later segment of that digest passes.
 * A digest without a slot is refused while the cap's worth of slots are less than a day old.
 */
function checkSlot(
  slots: readonly BlobEntry[],
  id: string,
  now: number,
): { held: boolean; refusal?: NarrateResult } {
  if (slots.some((entry) => entry.pathname === slotKey(id))) return { held: true };
  const cap = evaluateDailyCap(
    slots.map((entry) => entry.uploadedAt),
    now,
  );
  return cap.allowed ? { held: false } : { held: false, refusal: dailyCap(cap.retryAfterSeconds) };
}

/**
 * Two requests for one digest may both find no slot and both write it. They write the same object,
 * so the digest still holds exactly one.
 */
function takeSlot(blob: NarrateBlobStore, id: string, now: number): Promise<{ url: string }> {
  return blob.put(
    slotKey(id),
    `${JSON.stringify({ digest: id, taken_at: new Date(now).toISOString() })}\n`,
    { contentType: "application/json", cacheSeconds: JSON_CACHE_SECONDS },
  );
}

interface Plan {
  digest: Digest;
  spoken: SpokenText;
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
  /** When the request was authorized, for the total the log reports. */
  startedAt: number;
}

/**
 * Every check that costs nothing, in the order that answers soonest. It ends by writing the marker,
 * so a plan means this request owns the narration. Anything else is the answer to send.
 */
async function prepare(session: Session): Promise<Plan | NarrateResult> {
  const { id, config, blob, deps, log } = session;

  const existing = await findNarration(blob, deps.digests, id);
  if (existing) return ready(existing);

  const text = await deps.digests.readDigest(id);
  if (text === null) return digestNotFound;
  let digest: Digest;
  let spoken: SpokenText;
  try {
    digest = parseDigestFile(text);
    if (digest.id !== id) throw new Error(`the file holds digest ${digest.id}`);
    spoken = buildSpokenText(digest);
  } catch (error) {
    log(`narrate ${id}: cannot be read aloud: ${describeError(error, session.secrets)}`);
    return notNarratable;
  }

  const now = deps.now();
  const marker = await blob.head(markerKey(id));
  if (marker && now - marker.uploadedAt < MARKER_TTL_MS) {
    return inProgress(Math.max(1, Math.ceil((marker.uploadedAt + MARKER_TTL_MS - now) / 1000)));
  }

  const slot = checkSlot(await blob.list(SLOT_PREFIX), id, now);
  if (slot.refusal) return slot.refusal;

  const today = new Date(now);
  const budget = checkBudget({
    usage: await readUsage(blob, usageMonth(today)),
    now: today,
    requested: spoken.text.length,
    monthlyChars: config.monthlyChars ?? DEFAULT_MONTHLY_CHARS,
  });
  if (!budget.ok) {
    log(`narrate ${id}: refused. ${describeRefusal(budget)}`);
    return monthlyBudget;
  }

  // The slot first and the marker last: if anything here fails, no marker is left behind to block
  // the next attempt.
  if (!slot.held) await takeSlot(blob, id, now);
  await blob.put(
    markerKey(id),
    `${JSON.stringify({ digest: id, started_at: today.toISOString() })}\n`,
    { contentType: "application/json", cacheSeconds: JSON_CACHE_SECONDS },
  );
  return { digest, spoken };
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

async function putWithRetry(
  session: Session,
  pathname: string,
  body: Uint8Array | string,
  options: { contentType: string; cacheSeconds: number },
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const stored = await session.blob.put(pathname, body, options);
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

const voiceOf = (config: NarrateConfig): string => config.voiceId ?? DEFAULT_VOICE_ID;

interface Spoken extends Synthesis {
  synthesisMs: number;
}

/**
 * Has Speechify read `text`, under the one deadline. It returns the audio, or the answer to send
 * when there is none. The deadline's signal goes into every request, so when it passes the upstream
 * request is stopped, not left running.
 */
async function speak(session: Session, text: string): Promise<Spoken | NarrateResult> {
  const { label, config, deps, log, secrets } = session;

  const deadline = deps.startDeadline(SYNTHESIS_DEADLINE_MS);
  const speech = createSpeechifyClient({
    apiKey: config.speechifyKey,
    fetch: boundBy(deps.fetch, deadline.signal),
    timeoutMs: SYNTHESIS_DEADLINE_MS,
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
    // Speechify bills what it synthesized even when the stream did not finish. That spend is not
    // counted here (the counter only ever holds stored narrations), so the log says how much it was.
    const spent = error instanceof SpeechifyError ? (error.partialCharacters ?? 0) : 0;
    const cost = spent > 0 ? `, at least ${spent} characters were synthesized and not counted` : "";
    if (deadline.signal.aborted) {
      log(
        `${label}: synthesis passed the ${SYNTHESIS_DEADLINE_MS} ms deadline and was stopped${cost}`,
      );
      return tookTooLong;
    }
    log(`${label}: synthesis failed${cost}: ${describeError(error, secrets)}`);
    return synthesisFailed;
  } finally {
    deadline.cancel();
  }
}

/**
 * The paid part of a whole digest. The order of writes is the point: the MP3 first, because it is
 * what was paid for; the timeline second, because audio without it cannot be shown; the character
 * count last, so the counter never holds a narration the store does not.
 */
async function synthesizeAndStore(session: Session, plan: Plan): Promise<NarrateResult> {
  const { id, config, deps, log, secrets } = session;
  const voice = voiceOf(config);

  const narration = await speak(session, plan.spoken.text);
  if ("status" in narration) return narration;
  const { synthesisMs } = narration;
  const characters = narration.billableCharacters;

  let timeline: AudioTimeline;
  try {
    const resolved = resolveTimeline({
      digest: plan.digest,
      spoken: plan.spoken,
      marks: narration.marks,
      durationMs: narration.durationMs,
      voice,
      model: DEFAULT_MODEL,
    });
    timeline = resolved.timeline;
    if (resolved.degradedReason !== undefined) {
      log(`narrate ${id}: estimated timeline (${resolved.degradedReason})`);
    }
  } catch (error) {
    log(
      `narrate ${id}: no timeline could be built, ${characters} synthesized characters are lost ` +
        `and not counted: ${describeError(error, secrets)}`,
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
    await putWithRetry(session, timelineKey(id), `${JSON.stringify(timeline, null, 2)}\n`, {
      contentType: "application/json",
      cacheSeconds: JSON_CACHE_SECONDS,
    });
  } catch (error) {
    log(
      `narrate ${id}: upload failed for good, ${characters} synthesized characters are lost ` +
        `and not counted: ${describeError(error, secrets)}`,
    );
    return storageFailed;
  }
  const uploadMs = deps.now() - uploadStartedAt;

  try {
    await recordUsage(session.blob, new Date(deps.now()), characters);
  } catch (error) {
    // The listener has their audio. Only the bookkeeping is behind, and the log says by how much.
    log(
      `narrate ${id}: stored, but ${characters} characters could not be added to the counter: ` +
        describeError(error, secrets),
    );
  }

  // The limits in functionLimits.mjs are set from these: synthesis against the deadline, and the
  // total less synthesis against the time kept back for everything else.
  log(
    `narrate ${id}: stored. ${characters} characters, synthesis ${synthesisMs} ms, ` +
      `upload ${uploadMs} ms, total ${deps.now() - session.startedAt} ms, ` +
      `${timeline.timeline} timeline`,
  );
  return ready({ url, timeline });
}

function segmentReady(segment: NarrationSegment): NarrateResult {
  // Only called with a narrated segment; the check keeps the type honest without a cast.
  if (segment.audio === null) return unavailable;
  return { status: 200, body: { status: 200, segment: { ...segment, audio: segment.audio } } };
}

/**
 * POST /api/narrate with a segment: one stretch of the digest, narrated and stored as its own file.
 *
 * There is no in-progress marker and no manifest here. The file's name is the record (see
 * narrateSegments.ts), so two requests for different segments of one digest cannot undo each other:
 * each adds its own file. The page sends one segment at a time; if the same segment were ever
 * narrated twice at once, both files would be kept and every lookup would name the first.
 */
async function narrateSegment(session: Session, key: string): Promise<NarrateResult> {
  const { id, label, config, blob, deps, log, secrets } = session;

  // From the bundle only: an unknown digest or segment is refused before any store or speech call.
  const loaded = await loadSegments(deps.digests, id, log, secrets);
  if (!("segments" in loaded)) return loaded;
  const segment = loaded.segments.find((candidate) => candidate.key === key);
  if (!segment) return segmentNotFound;

  const voice = voiceOf(config);
  const hash = segmentHash(segment.text, voice, DEFAULT_MODEL);
  const now = deps.now();
  const today = new Date(now);

  // One round trip answers the three questions that cost nothing: is it already narrated, does the
  // digest hold a slot under the daily cap, and is there budget left this month.
  const [listing, slots, usage] = await Promise.all([
    blob.list(digestPrefix(id)),
    blob.list(SLOT_PREFIX),
    readUsage(blob, usageMonth(today)),
  ]);

  const [existing] = describeSegments([segment], listing, id, voice, DEFAULT_MODEL);
  if (existing?.audio) return segmentReady(existing);

  const slot = checkSlot(slots, id, now);
  if (slot.refusal) return slot.refusal;

  // The budget is charged for this segment's characters only.
  const budget = checkBudget({
    usage,
    now: today,
    requested: segment.text.length,
    monthlyChars: config.monthlyChars ?? DEFAULT_MONTHLY_CHARS,
  });
  if (!budget.ok) {
    log(`${label}: refused. ${describeRefusal(budget)}`);
    return monthlyBudget;
  }

  // The first segment of a digest takes its slot. That write runs beside the synthesis, because the
  // first segment is the one a listener is waiting to hear. If it fails the narration still stands
  // and the cap is one digest short, which the log records.
  const slotTaken = slot.held
    ? Promise.resolve()
    : takeSlot(blob, id, now).then(
        () => undefined,
        (error: unknown) => {
          log(`${label}: the daily slot could not be written: ${describeError(error, secrets)}`);
        },
      );

  // The duration comes from the stream's own done event. Word marks are not used for a segment.
  const narration = await speak(session, segment.text);
  if ("status" in narration) {
    await slotTaken;
    return narration;
  }
  const characters = narration.billableCharacters;
  const durationMs = Math.round(narration.durationMs);

  const uploadStartedAt = deps.now();
  let url: string;
  try {
    url = await putWithRetry(session, segmentPath(id, key, hash, durationMs), narration.audio, {
      contentType: "audio/mpeg",
      cacheSeconds: SEGMENT_CACHE_SECONDS,
    });
  } catch (error) {
    log(
      `${label}: upload failed for good, ${characters} synthesized characters are lost ` +
        `and not counted: ${describeError(error, secrets)}`,
    );
    await slotTaken;
    return storageFailed;
  }
  const uploadMs = deps.now() - uploadStartedAt;

  try {
    await recordUsage(blob, new Date(deps.now()), characters);
  } catch (error) {
    log(
      `${label}: stored, but ${characters} characters could not be added to the counter: ` +
        describeError(error, secrets),
    );
  }
  await slotTaken;

  log(
    `${label}: stored. ${characters} characters, synthesis ${narration.synthesisMs} ms, ` +
      `upload ${uploadMs} ms, total ${deps.now() - session.startedAt} ms`,
  );
  return segmentReady({
    key: segment.key,
    item_id: segment.itemId,
    characters: segment.text.length,
    audio: { url, duration_ms: durationMs },
  });
}

/** POST /api/narrate. */
export async function handleNarrate(
  input: NarrateInput,
  deps: NarrateDeps,
): Promise<NarrateResult> {
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
    startedAt: deps.now(),
  };

  if (request.segment !== undefined) {
    try {
      return await narrateSegment(session, request.segment);
    } catch (error) {
      log(`${session.label}: failed: ${describeError(error, session.secrets)}`);
      return unavailable;
    }
  }

  let plan: Plan | NarrateResult;
  try {
    plan = await prepare(session);
  } catch (error) {
    // Nothing has been spent yet, so a store that cannot be reached is simply "try again later".
    log(`narrate ${session.id}: could not start: ${describeError(error, session.secrets)}`);
    return unavailable;
  }
  if ("status" in plan) return plan;

  try {
    return await synthesizeAndStore(session, plan);
  } catch (error) {
    log(`narrate ${session.id}: failed unexpectedly: ${describeError(error, session.secrets)}`);
    return unavailable;
  } finally {
    // Cleared on every way out, so a failure never blocks the next attempt. If this fails too, the
    // marker expires on its own.
    try {
      await session.blob.del(markerKey(session.id));
    } catch (error) {
      log(
        `narrate ${session.id}: the marker was left behind and will expire: ` +
          describeError(error, session.secrets),
      );
    }
  }
}
