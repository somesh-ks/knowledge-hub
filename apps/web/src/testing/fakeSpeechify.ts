import type { FetchLike } from "../server/github";

/**
 * A fake Speechify for the narrate tests. It answers the two stream endpoints the way the real API
 * does (Server-Sent Events with base64 audio and word marks, or raw MP3 bytes), so the handler runs
 * the real client and the real parser against it. Nothing here touches the network.
 */

export interface SpeechifyCall {
  url: string;
  authorization: string | null;
  body: { input?: string; voice_id?: string; model?: string; output_format?: string };
  signal: AbortSignal | null;
}

export type FakeSpeechMode =
  /** A complete stream: two audio chunks, a mark for every word, then speech.done. */
  | { kind: "ok" }
  /** Every request answers with this status and JSON body. */
  | { kind: "http_error"; status: number; body: unknown; headers?: Record<string, string> }
  /** The marks endpoint refuses, the plain stream works. */
  | { kind: "no_marks" }
  /**
   * The stream sends one chunk covering the first `markedWords` words and then nothing. `onStall`
   * runs once the client has taken that chunk; a test uses it to let the deadline pass.
   */
  | { kind: "stall"; markedWords: number; onStall: () => void }
  /** The request never answers. `onHang` runs when it arrives. */
  | { kind: "hang"; onHang: () => void }
  /** The request cannot be sent at all. */
  | { kind: "throw"; error: Error };

export interface FakeSpeechify {
  fetch: FetchLike;
  calls: SpeechifyCall[];
}

/** The bytes the fake calls audio. Real enough to count, short enough to compare. */
export const FAKE_AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x20, 0x30]);
/**
 * What the plain stream returns. That endpoint reports no duration, so the client derives one from
 * the size: 64,000 bytes at 128 kbps is four seconds, long enough to hold a timeline.
 */
export const FAKE_PLAIN_AUDIO = new Uint8Array(64_000).fill(0x55);
export const MS_PER_WORD = 250;

export interface WordMark {
  type: "word";
  start: number;
  end: number;
  start_time: number;
  end_time: number;
  value: string;
}

/** One mark per word, with offsets into the text and a steady pace. */
export function wordMarks(text: string): WordMark[] {
  return [...text.matchAll(/\S+/g)].map((match, index) => ({
    type: "word",
    start: match.index,
    end: match.index + match[0].length,
    start_time: index * MS_PER_WORD,
    end_time: (index + 1) * MS_PER_WORD,
    value: match[0],
  }));
}

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function completeStream(text: string): string {
  const marks = wordMarks(text);
  const half = Math.ceil(marks.length / 2);
  return (
    sse("speech.chunk", {
      audio: base64(FAKE_AUDIO.slice(0, 4)),
      speech_marks: marks.slice(0, half),
    }) +
    sse("speech.chunk", { audio: base64(FAKE_AUDIO.slice(4)), speech_marks: marks.slice(half) }) +
    sse("speech.done", {
      billable_characters_count: text.length,
      audio_duration_ms: marks.length * MS_PER_WORD,
    })
  );
}

const eventStream = (body: BodyInit): Response =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

/** A stream that delivers one chunk and then waits until the request is aborted. */
function stalledStream(
  text: string,
  markedWords: number,
  signal: AbortSignal | null,
  onStall: () => void,
): ReadableStream<Uint8Array> {
  const first = sse("speech.chunk", {
    audio: base64(FAKE_AUDIO.slice(0, 4)),
    speech_marks: wordMarks(text).slice(0, markedWords),
  });
  let pulls = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(new TextEncoder().encode(first));
        return;
      }
      // The client has the first chunk and is waiting for the next one, which never comes.
      if (pulls === 2) onStall();
      return new Promise<void>(() => {});
    },
  });
}

export function createFakeSpeechify(mode: FakeSpeechMode = { kind: "ok" }): FakeSpeechify {
  const calls: SpeechifyCall[] = [];

  const fakeFetch: FetchLike = async (input, init) => {
    const signal = init?.signal ?? null;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({
      url: input,
      authorization: new Headers(init?.headers).get("authorization"),
      body,
      signal,
    });
    const text: string = typeof body.input === "string" ? body.input : "";
    const wantsMarks = input.endsWith("/with-timestamps");

    switch (mode.kind) {
      case "ok":
        return eventStream(completeStream(text));
      case "http_error":
        return new Response(JSON.stringify(mode.body), {
          status: mode.status,
          headers: { "Content-Type": "application/json", ...mode.headers },
        });
      case "no_marks":
        if (wantsMarks) {
          return new Response(
            JSON.stringify({ error: { code: "speech_marks_unsupported", message: "no marks" } }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(FAKE_PLAIN_AUDIO, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      case "stall":
        return eventStream(stalledStream(text, mode.markedWords, signal, mode.onStall));
      case "hang":
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          mode.onHang();
        });
      case "throw":
        throw mode.error;
      default: {
        const unreachable: never = mode;
        throw new Error(`Unknown fake Speechify mode ${JSON.stringify(unreachable)}`);
      }
    }
  };

  return { fetch: fakeFetch, calls };
}
