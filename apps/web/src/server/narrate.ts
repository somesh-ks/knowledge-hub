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
  type SpokenText,
  type SynthesisRequest,
  usageMonth,
} from "@dispatch/engine/audio";
import type { NarrateResponse } from "../types/contracts";
import type { NarrateBlobStore } from "./blobStore";
import {
  type BlobCredentials,
  blobSecretsOf,
  type NarrateConfig,
  narrateSecretsOf,
  readBlobCredentials,
  readNarrateConfig,
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
import { describeError } from "./redact";

/**
 * /api/narrate: narration made when a listener presses Play, not ahead of time.
 *
 * GET asks whether a digest has audio and returns it with its timeline. It needs no passphrase and
 * spends nothing. POST checks the passphrase and the limits, has Speechify read the digest, stores the
 * MP3 and the timeline in Blob, and returns the same body.
 *
 * The function keeps no state of its own. Everything it knows is in the Blob store: the audio, the
 * timeline, a marker while a narration runs, and the month's character count. Everything with a side
 * effect is a parameter (fetch, the clock, the deadline, the store, the digest files), so the whole
 * flow is tested with fakes and no network.
 */

export const AUDIO_PREFIX = "audio/";
export const audioKey = (id: string): string => `${AUDIO_PREFIX}${id}.mp3`;
export const timelineKey = (id: string): string => `timeline/${id}.json`;
export const markerKey = (id: string): string => `state/narrating-${id}.json`;
/** One counter per Stockholm month, YYYY-MM. */
export const usageKey = (month: string): string => `state/usage-${month}.json`;

/**
 * The lifetime the engine gives a narration. The URL is fixed per digest, so a long cache would let a
 * browser pair an old MP3 with a new timeline.
 */
const AUDIO_CACHE_SECONDS = 60 * 60;
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

/** A narration that exists rarely changes, and every page view asks, so the browser may keep it briefly. */
export const NARRATION_CACHE_CONTROL = "private, max-age=300";

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

type NarrateResult = ApiResult<NarrateResponse>;

const unavailable: NarrateResult = { status: 503, body: { status: 503, error: "unavailable" } };
const invalid: NarrateResult = { status: 400, body: { status: 400, error: "invalid_request" } };
const noAudio: NarrateResult = { status: 404, body: { status: 404, error: "no_audio" } };
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

/** Pulls the digest id and the passphrase out of a JSON body, or null when it is not that shape. */
export function parseNarrateRequest(
  bodyText: string,
): { digest: string; passphrase: string } | null {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { digest, passphrase } = parsed as { digest?: unknown; passphrase?: unknown };
  if (typeof passphrase !== "string") return null;
  if (passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_CHARS) return null;
  const id = parseDigestId(digest);
  return id === null ? null : { digest: id, passphrase };
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

/** The body is built field by field, so nothing in a stored timeline reaches the page unasked. */
function ready(narration: Narration): NarrateResult {
  const { timeline } = narration;
  return {
    status: 200,
    body: {
      status: 200,
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
    },
  };
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
 * A narration exists when the store has the MP3 and a timeline for it. The timeline is the one this
 * function stored, or, for a digest the audio workflow narrated before narrate on Play, the one
 * committed next to the digest.
 */
async function findNarration(
  blob: NarrateBlobStore,
  digests: DigestSource,
  id: string,
): Promise<Narration | null> {
  const audio = await blob.head(audioKey(id));
  if (audio === null || !isHttps(audio.url)) return null;
  const timeline =
    timelineFor(parseJson(await blob.readText(timelineKey(id))), id) ??
    timelineFor(await digests.readTimeline(id), id);
  return timeline ? { url: audio.url, timeline } : null;
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

  try {
    // Anyone can call this, and every store lookup is metered. An id that names no digest in this
    // deployment is answered from the bundle, so only real digests can cost a lookup.
    if ((await deps.digests.readDigest(id)) === null) return noAudio;
  } catch (error) {
    log(`lookup of ${id} failed: ${describeError(error, [])}`);
    return unavailable;
  }

  const credentials = readBlobCredentials(deps.env, input.requestOidcToken);
  if (!credentials) return unavailable;

  try {
    const found = await findNarration(deps.openBlob(credentials), deps.digests, id);
    if (!found) return noAudio;
    return { ...ready(found), headers: { "Cache-Control": NARRATION_CACHE_CONTROL } };
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

/** Read, add, write. Two narrations finishing together could lose one count; one listener makes that rare. */
async function recordUsage(blob: NarrateBlobStore, now: Date, characters: number): Promise<void> {
  const month = usageMonth(now);
  const next = addUsage(await readUsage(blob, month), now, characters);
  await blob.put(usageKey(month), `${JSON.stringify(next, null, 2)}\n`, {
    contentType: "application/json",
    cacheSeconds: JSON_CACHE_SECONDS,
  });
}

interface Plan {
  digest: Digest;
  spoken: SpokenText;
}

interface Session {
  id: string;
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

  const uploads = (await blob.list(AUDIO_PREFIX))
    .filter((entry) => entry.pathname.endsWith(".mp3"))
    .map((entry) => entry.uploadedAt);
  const cap = evaluateDailyCap(uploads, now);
  if (!cap.allowed) return dailyCap(cap.retryAfterSeconds);

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
        `narrate ${session.id}: upload of ${pathname} failed on attempt ${attempt}, retrying: ` +
          describeError(error, session.secrets),
      );
      await session.deps.delay(UPLOAD_RETRY_DELAY_MS * attempt);
    }
  }
}

/**
 * The paid part. The order of writes is the point: the MP3 first, because it is what was paid for;
 * the timeline second, because audio without it cannot be shown; the character count last, so the
 * counter never holds a narration the store does not.
 */
async function synthesizeAndStore(session: Session, plan: Plan): Promise<NarrateResult> {
  const { id, config, deps, log, secrets } = session;
  const voice = config.voiceId ?? DEFAULT_VOICE_ID;

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
  let narration: Synthesis;
  try {
    narration = await synthesize(
      speech,
      { text: plan.spoken.text, voiceId: voice, model: DEFAULT_MODEL },
      log,
    );
  } catch (error) {
    // Speechify bills what it synthesized even when the stream did not finish. That spend is not
    // counted here (the counter only ever holds stored narrations), so the log says how much it was.
    const spent = error instanceof SpeechifyError ? (error.partialCharacters ?? 0) : 0;
    const cost = spent > 0 ? `, at least ${spent} characters were synthesized and not counted` : "";
    if (deadline.signal.aborted) {
      log(
        `narrate ${id}: synthesis passed the ${SYNTHESIS_DEADLINE_MS} ms deadline and was stopped${cost}`,
      );
      return tookTooLong;
    }
    log(`narrate ${id}: synthesis failed${cost}: ${describeError(error, secrets)}`);
    return synthesisFailed;
  } finally {
    deadline.cancel();
  }
  const synthesisMs = deps.now() - startedAt;
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
    config,
    blob: deps.openBlob(config.blob),
    deps,
    secrets: narrateSecretsOf(config),
    log,
    startedAt: deps.now(),
  };

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
