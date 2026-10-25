import { z } from "zod";
import { readSse } from "./sse.js";

export const SPEECHIFY_BASE_URL = "https://api.speechify.ai";
export const DEFAULT_VOICE_ID = "geffen_32";
export const DEFAULT_MODEL = "simba-3.2";
export const DEFAULT_OUTPUT_FORMAT = "mp3_24000_128";

/** The MP3 formats `output_format` accepts on the stream endpoints, which is all we publish. */
export const MP3_OUTPUT_FORMATS = [
  "mp3_22050_32",
  "mp3_22050_64",
  "mp3_22050_96",
  "mp3_22050_128",
  "mp3_22050_160",
  "mp3_22050_192",
  "mp3_24000_32",
  "mp3_24000_64",
  "mp3_24000_96",
  "mp3_24000_128",
  "mp3_24000_160",
  "mp3_24000_192",
] as const;
export type Mp3OutputFormat = (typeof MP3_OUTPUT_FORMATS)[number];

/** One word-level speech mark. Times are absolute milliseconds from the start of the audio. */
export const SpeechMark = z.object({
  type: z.string().optional(),
  /** Character offsets into the request `input`, end exclusive. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  start_time: z.number().nonnegative(),
  end_time: z.number().nonnegative(),
  value: z.string(),
});
export type SpeechMark = z.infer<typeof SpeechMark>;

const ChunkPayload = z.object({
  audio: z.string().optional(),
  speech_marks: z.array(z.unknown()).optional(),
});

const DonePayload = z.object({
  billable_characters_count: z.number().nonnegative().optional(),
  audio_duration_ms: z.number().positive().optional(),
});

const ErrorEnvelope = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  request_id: z.string().optional(),
});

export interface SynthesisRequest {
  text: string;
  voiceId?: string;
  model?: string;
  outputFormat?: Mp3OutputFormat;
}

export interface MarksSynthesis {
  audio: Uint8Array;
  marks: SpeechMark[];
  durationMs: number;
  billableCharacters: number;
}

/** Audio from the plain stream endpoint. Duration and billing are derived locally. */
export interface AudioSynthesis {
  audio: Uint8Array;
  durationMs: number;
  billableCharacters: number;
}

/** What publishing needs from a TTS provider. The real client and test fakes both satisfy it. */
export interface SpeechSynthesizer {
  synthesizeWithMarks(request: SynthesisRequest): Promise<MarksSynthesis>;
  synthesize(request: SynthesisRequest): Promise<AudioSynthesis>;
}

export interface SpeechifyErrorInit {
  status?: number;
  code?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  /** Characters the stream had demonstrably synthesized (by its marks) before it failed. */
  partialCharacters?: number;
}

/** A failed Speechify call. The message is scrubbed of the API key before it is built. */
export class SpeechifyError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  /** Billing is per character synthesized, so a failed stream may still have cost this much. */
  readonly partialCharacters: number | undefined;

  constructor(message: string, init: SpeechifyErrorInit = {}) {
    super(message);
    this.name = "SpeechifyError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.partialCharacters = init.partialCharacters;
  }
}

/** True when the with-timestamps route cannot serve this account or model, so plain audio can. */
export function isMarksUnavailable(error: unknown): boolean {
  if (!(error instanceof SpeechifyError)) return false;
  return error.code === "speech_marks_unsupported" || error.status === 403 || error.status === 404;
}

export interface SpeechifyClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Used for the whole call, body included. */
  timeoutMs?: number;
  /** Retries after a 429. The brief caps this at three. */
  maxRetries?: number;
  /** Longer Retry-After values are not waited out; the call fails with the wait in the message. */
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  defaultVoiceId?: string;
}

/** Covers the whole stream. Synthesis runs faster than real time, but a 4 to 8 minute digest still takes a while. */
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_RETRY_WAIT_MS = 60_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A loop, not `/\/+$/`: that regex rescans a long run of slashes from every start (CodeQL). */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

/** Speechify text to speech over HTTP, with the fetch, base URL and key injected. */
export function createSpeechifyClient(options: SpeechifyClientOptions): SpeechSynthesizer {
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? SPEECHIFY_BASE_URL);
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
  const apiKey = options.apiKey;

  /** Every message that leaves this module passes through here, so the key cannot leak. */
  const scrub = (text: string): string =>
    apiKey.length > 0 ? text.split(apiKey).join("[redacted]") : text;

  const fail = (message: string, init: SpeechifyErrorInit = {}): SpeechifyError =>
    new SpeechifyError(scrub(message), init);

  async function describeFailure(response: Response): Promise<SpeechifyError> {
    const requestId = response.headers.get("speechify-request-id") ?? undefined;
    let code: string | undefined;
    let detail = "";
    try {
      const parsed = ErrorEnvelope.safeParse(JSON.parse(await response.text()));
      if (parsed.success) {
        code = parsed.data.error?.code;
        detail = parsed.data.error?.message ?? "";
      }
    } catch {
      // A non-JSON error body adds nothing beyond the status line.
    }
    const status = response.status;
    const label = code ? `${status} ${code}` : String(status);
    return fail(`Speechify request failed (HTTP ${label})${detail ? `: ${detail}` : ""}`, {
      status,
      ...(code ? { code } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }

  function retryDelayMs(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after");
    if (header !== null) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
      const date = Date.parse(header);
      if (!Number.isNaN(date)) return Math.max(0, date - now().getTime());
    }
    return 1000 * 2 ** attempt;
  }

  /** POST with 429 handling. Returns the first non-429 response; the caller checks `ok`. */
  async function post(path: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw fail(`Speechify request timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw fail(`Speechify request could not be sent: ${reason}`);
      }
      if (response.status !== 429) return response;

      const failure = await describeFailure(response);
      const waitMs = retryDelayMs(response, attempt);
      const retryAfterSeconds = Math.ceil(waitMs / 1000);
      if (attempt >= maxRetries) {
        throw fail(`${failure.message} after ${maxRetries} retries`, {
          status: 429,
          ...(failure.code ? { code: failure.code } : {}),
          retryAfterSeconds,
        });
      }
      if (waitMs > maxRetryWaitMs) {
        throw fail(`${failure.message}; Retry-After is ${retryAfterSeconds}s, too long to wait`, {
          status: 429,
          ...(failure.code ? { code: failure.code } : {}),
          retryAfterSeconds,
        });
      }
      await sleep(waitMs);
    }
  }

  function requestBody(request: SynthesisRequest): Record<string, string> {
    return {
      input: request.text,
      voice_id: request.voiceId ?? options.defaultVoiceId ?? DEFAULT_VOICE_ID,
      model: request.model ?? DEFAULT_MODEL,
      output_format: request.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    };
  }

  function decodeAudio(encoded: string): Uint8Array {
    const clean = encoded.replace(/\s+/g, "");
    if (!BASE64.test(clean)) throw fail("Speechify sent an audio chunk that is not valid base64");
    return new Uint8Array(Buffer.from(clean, "base64"));
  }

  async function readMarksStream(
    body: ReadableStream<Uint8Array>,
    text: string,
    progress: { characters: number },
  ): Promise<MarksSynthesis> {
    const parts: Uint8Array[] = [];
    const marks: SpeechMark[] = [];
    let done: z.infer<typeof DonePayload> | undefined;

    for await (const event of readSse(body)) {
      let name = event.event;
      let payload: unknown;
      if (name === "message") {
        // The payload's `type` mirrors the event name, so a stream without `event:` lines works.
        payload = parseJson(event.data);
        const type = (payload as { type?: unknown } | null)?.type;
        name = typeof type === "string" ? type : name;
      }
      if (name !== "speech.chunk" && name !== "speech.done" && name !== "speech.error") continue;
      payload ??= parseJson(event.data);

      if (name === "speech.error") {
        const parsed = ErrorEnvelope.safeParse(payload);
        const code = parsed.success ? parsed.data.error?.code : undefined;
        const detail = parsed.success ? parsed.data.error?.message : undefined;
        throw fail(
          `Speechify stream failed${code ? ` (${code})` : ""}${detail ? `: ${detail}` : ""}`,
          code ? { code } : {},
        );
      }
      if (name === "speech.chunk") {
        const chunk = ChunkPayload.safeParse(payload);
        // A malformed chunk must fail the call: skipping it would splice silent gaps into the audio.
        if (!chunk.success) throw fail("Speechify sent a malformed speech.chunk event");
        // Each chunk is base64 on its own; decode per chunk, never across chunks.
        if (chunk.data.audio) parts.push(decodeAudio(chunk.data.audio));
        for (const raw of chunk.data.speech_marks ?? []) {
          const mark = SpeechMark.safeParse(raw);
          if (mark.success) {
            marks.push(mark.data);
            progress.characters = Math.max(progress.characters, mark.data.end);
          }
        }
        continue;
      }
      const parsedDone = DonePayload.safeParse(payload);
      if (parsedDone.success) done = parsedDone.data;
      break;
    }

    if (!done) throw fail("Speechify stream ended before speech.done, so the audio is incomplete");
    const audio = new Uint8Array(Buffer.concat(parts));
    if (audio.byteLength === 0) throw fail("Speechify stream carried no audio");
    const lastMarkEnd = marks.reduce((latest, mark) => Math.max(latest, mark.end_time), 0);
    const durationMs = Math.round(done.audio_duration_ms ?? lastMarkEnd);
    if (durationMs <= 0) throw fail("Speechify stream did not report an audio duration");
    return {
      audio,
      marks,
      durationMs,
      billableCharacters: Math.round(done.billable_characters_count ?? text.length),
    };
  }

  function parseJson(data: string): unknown {
    try {
      return JSON.parse(data);
    } catch {
      throw fail("Speechify sent an event whose data is not valid JSON");
    }
  }

  return {
    async synthesizeWithMarks(request) {
      const response = await post("/v1/audio/stream/with-timestamps", requestBody(request));
      if (!response.ok) throw await describeFailure(response);
      if (!response.body) throw fail("Speechify returned no response body");
      const progress = { characters: 0 };
      try {
        return await readMarksStream(response.body, request.text, progress);
      } catch (error) {
        const partial = progress.characters > 0 ? { partialCharacters: progress.characters } : {};
        if (error instanceof SpeechifyError) {
          if (progress.characters === 0) throw error;
          throw fail(error.message, {
            ...(error.code ? { code: error.code } : {}),
            ...partial,
          });
        }
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        ) {
          throw fail(`Speechify stream timed out after ${Math.round(timeoutMs / 1000)}s`, partial);
        }
        throw fail(
          `Speechify stream was interrupted: ${error instanceof Error ? error.message : String(error)}`,
          partial,
        );
      }
    },

    async synthesize(request) {
      const response = await post("/v1/audio/stream", requestBody(request));
      if (!response.ok) throw await describeFailure(response);
      let audio: Uint8Array;
      try {
        audio = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw fail(
          `Speechify audio download was interrupted: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (audio.byteLength === 0) throw fail("Speechify returned an empty audio body");
      const format = request.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
      return {
        audio,
        durationMs: durationFromMp3Bytes(audio.byteLength, format),
        billableCharacters: request.text.length,
      };
    },
  };
}

/** Bitrate in kbps encoded in a format name such as mp3_24000_128. */
export function mp3BitrateKbps(format: Mp3OutputFormat): number {
  const kbps = Number(format.split("_")[2]);
  return kbps;
}

/**
 * Duration of a constant-bitrate MP3 from its size. The plain stream endpoint reports no duration,
 * so the estimated-timeline fallback derives it. Accurate to a few frames for CBR output.
 */
export function durationFromMp3Bytes(byteLength: number, format: Mp3OutputFormat): number {
  return Math.max(1, Math.round((byteLength * 8) / mp3BitrateKbps(format)));
}
