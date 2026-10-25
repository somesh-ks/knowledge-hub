import { describe, expect, it } from "vitest";
import {
  createSpeechifyClient,
  DEFAULT_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_VOICE_ID,
  durationFromMp3Bytes,
  isMarksUnavailable,
  SpeechifyError,
} from "../src/audio/speechify.js";
import { FAKE_SPEECHIFY_KEY, must } from "./audio-fixtures.js";
import type { MockServer } from "./audio-mockServer.js";
import { jsonError, sseEvent, startMockServer, startSse, writeSliced } from "./audio-mockServer.js";

function serve(...args: Parameters<typeof startMockServer>): Promise<MockServer> {
  return Promise.resolve(startMockServer(...args));
}

const AUDIO_A = Buffer.from("ID3-first-chunk-of-audio-bytes");
const AUDIO_B = Buffer.from("second-chunk-of-audio-bytes-continues");

const MARK_HELLO = {
  type: "word",
  start: 0,
  end: 5,
  start_time: 125,
  end_time: 469,
  value: "Hello",
};
const MARK_WORLD = {
  type: "word",
  start: 6,
  end: 12,
  start_time: 469,
  end_time: 1152,
  value: "world.",
};

function standardStream(): string {
  return (
    sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64"), speech_marks: [MARK_HELLO] }) +
    sseEvent("speech.chunk", { audio: AUDIO_B.toString("base64") }) +
    sseEvent("speech.chunk", { speech_marks: [MARK_WORLD] }) +
    sseEvent("speech.done", { billable_characters_count: 12, audio_duration_ms: 4350 })
  );
}

function client(
  server: MockServer,
  options: Partial<Parameters<typeof createSpeechifyClient>[0]> = {},
) {
  return createSpeechifyClient({
    apiKey: FAKE_SPEECHIFY_KEY,
    baseUrl: server.url,
    fetch: server.fetch,
    sleep: async () => {},
    ...options,
  });
}

const REQUEST = { text: "Hello world." };

describe("synthesizeWithMarks", () => {
  it("returns the concatenated audio, marks, duration and billable characters", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(standardStream());
    });
    const result = await client(server).synthesizeWithMarks(REQUEST);
    expect(Buffer.from(result.audio).equals(Buffer.concat([AUDIO_A, AUDIO_B]))).toBe(true);
    expect(result.marks).toEqual([MARK_HELLO, MARK_WORLD]);
    expect(result.durationMs).toBe(4350);
    expect(result.billableCharacters).toBe(12);
    expect(result.audio).toBeInstanceOf(Uint8Array);
  });

  it("sends the documented request: path, bearer auth, JSON body, no Accept header", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(standardStream());
    });
    await client(server).synthesizeWithMarks({
      text: "Hello world.",
      voiceId: "voice_x",
      model: "simba-3.0",
      language: "en-US",
      outputFormat: "mp3_24000_64",
    });
    const request = must(server.requests[0]);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/v1/audio/stream/with-timestamps");
    expect(request.headers.authorization).toBe(`Bearer ${FAKE_SPEECHIFY_KEY}`);
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers.accept).not.toBe("text/event-stream");
    expect(JSON.parse(request.body)).toEqual({
      input: "Hello world.",
      voice_id: "voice_x",
      model: "simba-3.0",
      language: "en-US",
      output_format: "mp3_24000_64",
    });
  });

  it("sends the default voice, model and output format when the request names none", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(standardStream());
    });
    await client(server).synthesizeWithMarks(REQUEST);
    expect(JSON.parse(must(server.requests[0]).body)).toMatchObject({
      voice_id: DEFAULT_VOICE_ID,
      model: DEFAULT_MODEL,
      output_format: DEFAULT_OUTPUT_FORMAT,
    });
  });

  it("uses the client's default voice when the request names none", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(standardStream());
    });
    await client(server, { defaultVoiceId: "custom_voice" }).synthesizeWithMarks(REQUEST);
    expect(JSON.parse(must(server.requests[0]).body).voice_id).toBe("custom_voice");
  });

  it("parses a stream delivered in tiny slices, splitting events, JSON and base64", async () => {
    const server = await serve(async (_req, res) => {
      startSse(res);
      await writeSliced(res, standardStream(), 7);
      res.end();
    });
    const result = await client(server).synthesizeWithMarks(REQUEST);
    expect(Buffer.from(result.audio).equals(Buffer.concat([AUDIO_A, AUDIO_B]))).toBe(true);
    expect(result.marks).toHaveLength(2);
    expect(result.durationMs).toBe(4350);
  });

  it("handles a marks-only final chunk and an audio-only first chunk", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64") }) +
          sseEvent("speech.chunk", { speech_marks: [MARK_HELLO, MARK_WORLD] }) +
          sseEvent("speech.done", { billable_characters_count: 12, audio_duration_ms: 1200 }),
      );
    });
    const result = await client(server).synthesizeWithMarks(REQUEST);
    expect(result.marks).toHaveLength(2);
    expect(Buffer.from(result.audio).equals(AUDIO_A)).toBe(true);
  });

  it("ignores unknown event types", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.future", { anything: true }) +
          sseEvent("speech.chunk", {
            audio: AUDIO_A.toString("base64"),
            speech_marks: [MARK_HELLO],
          }) +
          sseEvent("speech.done", { billable_characters_count: 5, audio_duration_ms: 500 }),
      );
    });
    expect((await client(server).synthesizeWithMarks(REQUEST)).marks).toEqual([MARK_HELLO]);
  });

  it("routes events by the payload type when the stream has no event lines", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent(undefined, {
          type: "speech.chunk",
          audio: AUDIO_A.toString("base64"),
          speech_marks: [MARK_HELLO],
        }) +
          sseEvent(undefined, {
            type: "speech.done",
            billable_characters_count: 5,
            audio_duration_ms: 500,
          }),
      );
    });
    const result = await client(server).synthesizeWithMarks(REQUEST);
    expect(result.durationMs).toBe(500);
    expect(result.marks).toHaveLength(1);
  });

  it("drops malformed marks and keeps the valid ones", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", {
          audio: AUDIO_A.toString("base64"),
          speech_marks: [{ type: "word", start: "x" }, MARK_HELLO, null],
        }) + sseEvent("speech.done", { billable_characters_count: 5, audio_duration_ms: 500 }),
      );
    });
    expect((await client(server).synthesizeWithMarks(REQUEST)).marks).toEqual([MARK_HELLO]);
  });

  it("falls back to the last mark's end time when done omits the duration", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", {
          audio: AUDIO_A.toString("base64"),
          speech_marks: [MARK_HELLO, MARK_WORLD],
        }) + sseEvent("speech.done", { billable_characters_count: 12 }),
      );
    });
    expect((await client(server).synthesizeWithMarks(REQUEST)).durationMs).toBe(1152);
  });

  it("falls back to the text length when done omits the billable count", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64") }) +
          sseEvent("speech.done", { audio_duration_ms: 900 }),
      );
    });
    expect((await client(server).synthesizeWithMarks(REQUEST)).billableCharacters).toBe(
      REQUEST.text.length,
    );
  });

  it("raises a mid-stream speech.error with its code", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64") }) +
          sseEvent("speech.error", {
            error: { code: "upstream_failure", message: "synthesis failed mid-stream" },
            request_id: "r1",
          }),
      );
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toMatchObject({
      name: "SpeechifyError",
      code: "upstream_failure",
      message: expect.stringContaining("synthesis failed mid-stream"),
    });
  });

  it("reports the characters already synthesized when a stream fails midway", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", {
          audio: AUDIO_A.toString("base64"),
          speech_marks: [MARK_HELLO, MARK_WORLD],
        }) +
          sseEvent("speech.error", {
            error: { code: "upstream_failure", message: "synthesis failed mid-stream" },
          }),
      );
    });
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechifyError);
    expect((failure as SpeechifyError).partialCharacters).toBe(12);
    expect((failure as SpeechifyError).code).toBe("upstream_failure");
    expect((failure as SpeechifyError).message).not.toContain(FAKE_SPEECHIFY_KEY);
  });

  it("reports partial characters when the stream is cut before speech.done", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", {
          audio: AUDIO_A.toString("base64"),
          speech_marks: [MARK_HELLO],
        }),
      );
    });
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).partialCharacters).toBe(5);
  });

  it("reports no partial characters when nothing was synthesized before the failure", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.error", { error: { code: "upstream_failure", message: "no luck" } }),
      );
    });
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).partialCharacters).toBeUndefined();
  });

  it("does not count partial characters for a failure before the stream starts", async () => {
    const server = await serve((_req, res) => jsonError(res, 500, "internal_error", "boom"));
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).partialCharacters).toBeUndefined();
  });

  it("rejects a stream that ends before speech.done, since its audio is truncated", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64"), speech_marks: [MARK_HELLO] }),
      );
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(
      /before speech\.done/,
    );
  });

  it("rejects a stream that carries no audio", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { speech_marks: [MARK_HELLO] }) +
          sseEvent("speech.done", { audio_duration_ms: 500 }),
      );
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(/no audio/);
  });

  it("rejects an audio chunk that is not base64", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: "not*base64!" }) +
          sseEvent("speech.done", { audio_duration_ms: 500 }),
      );
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(/base64/);
  });

  it("rejects an event whose data is not JSON", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end("event: speech.chunk\ndata: {broken\n\n");
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(/not valid JSON/);
  });

  it("rejects a malformed chunk rather than skipping its audio", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(
        sseEvent("speech.chunk", { audio: 12345 }) +
          sseEvent("speech.done", { billable_characters_count: 5, audio_duration_ms: 500 }),
      );
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(
      /malformed speech\.chunk/,
    );
  });

  it("rejects when the connection drops mid-stream", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.write(sseEvent("speech.chunk", { audio: AUDIO_A.toString("base64") }));
      res.destroy();
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toBeInstanceOf(
      SpeechifyError,
    );
  });

  it("times out when the server never answers", async () => {
    const timedOut: typeof fetch = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    const speech = createSpeechifyClient({ apiKey: FAKE_SPEECHIFY_KEY, fetch: timedOut });
    await expect(speech.synthesizeWithMarks(REQUEST)).rejects.toThrow(/timed out/);
  });

  it("normalizes a trailing slash on the base URL", async () => {
    const server = await serve((_req, res) => {
      startSse(res);
      res.end(standardStream());
    });
    await client(server, { baseUrl: `${server.url}///` }).synthesizeWithMarks(REQUEST);
    expect(must(server.requests[0]).url).toBe("/v1/audio/stream/with-timestamps");
  });
});

describe("rate limiting", () => {
  it("waits out Retry-After and retries", async () => {
    const waits: number[] = [];
    const server = await serve((_req, res, _rec, index) => {
      if (index === 0)
        return jsonError(res, 429, "rate_limited", "slow down", { "Retry-After": "2" });
      startSse(res);
      res.end(standardStream());
    });
    const result = await client(server, {
      sleep: async (ms) => void waits.push(ms),
    }).synthesizeWithMarks(REQUEST);
    expect(result.durationMs).toBe(4350);
    expect(waits).toEqual([2000]);
    expect(server.requests).toHaveLength(2);
  });

  it("reads Retry-After given as an HTTP date", async () => {
    const waits: number[] = [];
    const now = new Date("2026-10-07T06:00:00Z");
    const server = await serve((_req, res, _rec, index) => {
      if (index === 0) {
        return jsonError(res, 429, "rate_limited", "slow down", {
          "Retry-After": new Date(now.getTime() + 3000).toUTCString(),
        });
      }
      startSse(res);
      res.end(standardStream());
    });
    await client(server, {
      now: () => now,
      sleep: async (ms) => void waits.push(ms),
    }).synthesizeWithMarks(REQUEST);
    expect(waits).toEqual([3000]);
  });

  it("backs off exponentially when there is no Retry-After", async () => {
    const waits: number[] = [];
    const server = await serve((_req, res, _rec, index) => {
      if (index < 3) return jsonError(res, 429, "concurrency_limit_reached", "too many at once");
      startSse(res);
      res.end(standardStream());
    });
    await client(server, { sleep: async (ms) => void waits.push(ms) }).synthesizeWithMarks(REQUEST);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("gives up after three retries, four requests in all", async () => {
    const waits: number[] = [];
    const server = await serve((_req, res) =>
      jsonError(res, 429, "rate_limited", "slow down", { "Retry-After": "1" }),
    );
    const failure = await client(server, { sleep: async (ms) => void waits.push(ms) })
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechifyError);
    expect((failure as SpeechifyError).status).toBe(429);
    expect((failure as SpeechifyError).code).toBe("rate_limited");
    expect((failure as SpeechifyError).message).toMatch(/after 3 retries/);
    expect(server.requests).toHaveLength(4);
    expect(waits).toEqual([1000, 1000, 1000]);
  });

  it("honours a lower retry budget", async () => {
    const server = await serve((_req, res) =>
      jsonError(res, 429, "rate_limited", "slow down", { "Retry-After": "1" }),
    );
    await expect(client(server, { maxRetries: 1 }).synthesizeWithMarks(REQUEST)).rejects.toThrow(
      /after 1 retries/,
    );
    expect(server.requests).toHaveLength(2);
  });

  it("does not wait out a Retry-After longer than the cap", async () => {
    const waits: number[] = [];
    const server = await serve((_req, res) =>
      jsonError(res, 429, "rate_limited", "slow down", { "Retry-After": "3600" }),
    );
    const failure = await client(server, { sleep: async (ms) => void waits.push(ms) })
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).retryAfterSeconds).toBe(3600);
    expect((failure as SpeechifyError).message).toMatch(/too long to wait/);
    expect(waits).toEqual([]);
    expect(server.requests).toHaveLength(1);
  });

  it("retries the plain stream endpoint the same way", async () => {
    const waits: number[] = [];
    const server = await serve((_req, res, _rec, index) => {
      if (index === 0)
        return jsonError(res, 429, "rate_limited", "slow down", { "Retry-After": "1" });
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(Buffer.alloc(1600));
    });
    await client(server, { sleep: async (ms) => void waits.push(ms) }).synthesize(REQUEST);
    expect(waits).toEqual([1000]);
  });
});

describe("errors", () => {
  it("reports status, code, message and request id without the key", async () => {
    const server = await serve((_req, res) =>
      jsonError(res, 401, "unauthorized", "invalid credentials"),
    );
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SpeechifyError);
    const error = failure as SpeechifyError;
    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
    expect(error.message).toBe(
      "Speechify request failed (HTTP 401 unauthorized): invalid credentials",
    );
    expect(error.message).not.toContain(FAKE_SPEECHIFY_KEY);
  });

  it("redacts the key even when the server echoes it back", async () => {
    const server = await serve((_req, res) =>
      jsonError(res, 400, "bad_request", `bad key ${FAKE_SPEECHIFY_KEY} in header`),
    );
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    const error = failure as SpeechifyError;
    expect(error.message).not.toContain(FAKE_SPEECHIFY_KEY);
    expect(error.message).toContain("[redacted]");
  });

  it("redacts the key from transport errors", async () => {
    const failingFetch: typeof fetch = async () => {
      throw new TypeError(`connect failed with Authorization: Bearer ${FAKE_SPEECHIFY_KEY}`);
    };
    const speech = createSpeechifyClient({ apiKey: FAKE_SPEECHIFY_KEY, fetch: failingFetch });
    const failure = await speech.synthesizeWithMarks(REQUEST).catch((error: unknown) => error);
    expect((failure as Error).message).toContain("could not be sent");
    expect((failure as Error).message).not.toContain(FAKE_SPEECHIFY_KEY);
  });

  it("copes with a non-JSON error body", async () => {
    const server = await serve((_req, res) => {
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end("<html>Bad gateway</html>");
    });
    await expect(client(server).synthesizeWithMarks(REQUEST)).rejects.toThrow(
      "Speechify request failed (HTTP 502)",
    );
  });

  it("carries the request id header on failures", async () => {
    const server = await serve((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json", "Speechify-Request-Id": "abc-123" });
      res.end(JSON.stringify({ error: { code: "internal_error", message: "boom" } }));
    });
    const failure = await client(server)
      .synthesizeWithMarks(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).requestId).toBe("abc-123");
  });

  it("flags only the unavailable-marks failures as ones the plain stream can serve", () => {
    expect(
      isMarksUnavailable(
        new SpeechifyError("x", { status: 400, code: "speech_marks_unsupported" }),
      ),
    ).toBe(true);
    expect(isMarksUnavailable(new SpeechifyError("x", { status: 403 }))).toBe(true);
    expect(isMarksUnavailable(new SpeechifyError("x", { status: 404 }))).toBe(true);
    expect(isMarksUnavailable(new SpeechifyError("x", { status: 401, code: "unauthorized" }))).toBe(
      false,
    );
    expect(isMarksUnavailable(new SpeechifyError("x", { status: 429 }))).toBe(false);
    expect(isMarksUnavailable(new Error("plain"))).toBe(false);
  });
});

describe("synthesize (plain stream)", () => {
  it("returns the audio with a duration derived from the bitrate", async () => {
    const audio = Buffer.alloc(32_000, 7);
    const server = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      res.end(audio);
    });
    const result = await client(server).synthesize(REQUEST);
    expect(must(server.requests[0]).url).toBe("/v1/audio/stream");
    expect(Buffer.from(result.audio).equals(audio)).toBe(true);
    // 32,000 bytes at 128 kbps is two seconds.
    expect(result.durationMs).toBe(2000);
    expect(result.billableCharacters).toBe(REQUEST.text.length);
  });

  it("sends the same body as the marks endpoint", async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(100));
    });
    await client(server).synthesize({ text: "Hi.", outputFormat: "mp3_24000_64" });
    expect(JSON.parse(must(server.requests[0]).body)).toEqual({
      input: "Hi.",
      voice_id: "geffen_32",
      model: "simba-3.2",
      language: "en-US",
      output_format: "mp3_24000_64",
    });
  });

  it("rejects an empty body", async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    await expect(client(server).synthesize(REQUEST)).rejects.toThrow(/empty audio/);
  });

  it("surfaces HTTP errors without the key", async () => {
    const server = await serve((_req, res) =>
      jsonError(res, 402, "payment_required", "out of credits"),
    );
    const failure = await client(server)
      .synthesize(REQUEST)
      .catch((error: unknown) => error);
    expect((failure as SpeechifyError).status).toBe(402);
    expect((failure as Error).message).not.toContain(FAKE_SPEECHIFY_KEY);
  });
});

describe("mp3 helpers", () => {
  it.each([
    [16_000, "mp3_24000_128", 1000],
    [8000, "mp3_24000_64", 1000],
    [4000, "mp3_22050_32", 1000],
    [24_000, "mp3_24000_192", 1000],
  ] as const)("derives %i bytes at %s as %i ms", (bytes, format, expected) => {
    expect(durationFromMp3Bytes(bytes, format)).toBe(expected);
  });

  it("never reports a zero duration", () => {
    expect(durationFromMp3Bytes(1, "mp3_24000_192")).toBeGreaterThanOrEqual(1);
  });
});
