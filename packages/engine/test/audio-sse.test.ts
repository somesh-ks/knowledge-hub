import { describe, expect, it } from "vitest";
import type { SseEvent } from "../src/audio/sse.js";
import { readSse, SseDecoder } from "../src/audio/sse.js";
import { must } from "./audio-fixtures.js";

const encoder = new TextEncoder();

function decodeAll(chunks: Uint8Array[]): SseEvent[] {
  const decoder = new SseDecoder();
  const events = chunks.flatMap((chunk) => decoder.push(chunk));
  return [...events, ...decoder.end()];
}

function bytesIn(text: string, size: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size)
    chunks.push(bytes.subarray(offset, offset + size));
  return chunks;
}

const SAMPLE =
  'event: speech.chunk\ndata: {"audio":"SUQzBAAAAAAA","speech_marks":[{"start":0,"end":5}]}\n\n' +
  'event: speech.chunk\ndata: {"speech_marks":[{"start":6,"end":12}]}\n\n' +
  'event: speech.done\ndata: {"billable_characters_count":40,"audio_duration_ms":4350}\n\n';

describe("SseDecoder", () => {
  it("decodes named events", () => {
    const events = decodeAll([encoder.encode(SAMPLE)]);
    expect(events.map((event) => event.event)).toEqual([
      "speech.chunk",
      "speech.chunk",
      "speech.done",
    ]);
    expect(JSON.parse(must(events[2]).data)).toEqual({
      billable_characters_count: 40,
      audio_duration_ms: 4350,
    });
  });

  it("names an event without an event field 'message'", () => {
    expect(decodeAll([encoder.encode('data: {"type":"speech.done"}\n\n')])).toEqual([
      { event: "message", data: '{"type":"speech.done"}' },
    ]);
  });

  it("returns the same events whichever byte the stream is split at", () => {
    const expected = decodeAll([encoder.encode(SAMPLE)]);
    const bytes = encoder.encode(SAMPLE);
    for (let split = 1; split < bytes.length; split++) {
      expect(decodeAll([bytes.subarray(0, split), bytes.subarray(split)])).toEqual(expected);
    }
  });

  it("handles a stream delivered one byte at a time", () => {
    expect(decodeAll(bytesIn(SAMPLE, 1))).toEqual(decodeAll([encoder.encode(SAMPLE)]));
  });

  it("keeps a base64 payload intact when it is split mid-string", () => {
    const base64 = Buffer.from("a long enough run of audio bytes to split".repeat(4)).toString(
      "base64",
    );
    const text = `event: speech.chunk\ndata: ${JSON.stringify({ audio: base64 })}\n\n`;
    const events = decodeAll(bytesIn(text, 13));
    expect(JSON.parse(must(events[0]).data).audio).toBe(base64);
  });

  it("accepts CRLF line endings", () => {
    expect(
      decodeAll([encoder.encode("event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n")]),
    ).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });

  it("accepts lone CR terminators", () => {
    expect(decodeAll([encoder.encode("event: a\rdata: 1\r\r")])).toEqual([
      { event: "a", data: "1" },
    ]);
  });

  it("does not split a CRLF that arrives across two chunks", () => {
    const events = decodeAll([
      encoder.encode("event: a\r"),
      encoder.encode("\ndata: 1\r"),
      encoder.encode("\n\r"),
      encoder.encode("\n"),
    ]);
    expect(events).toEqual([{ event: "a", data: "1" }]);
  });

  it("ignores comment lines", () => {
    expect(decodeAll([encoder.encode(": keep-alive\nevent: a\n: another\ndata: 1\n\n")])).toEqual([
      { event: "a", data: "1" },
    ]);
  });

  it("joins multi-line data with a newline", () => {
    expect(decodeAll([encoder.encode("data: one\ndata: two\n\n")])).toEqual([
      { event: "message", data: "one\ntwo" },
    ]);
  });

  it("strips a single leading space from a value and no more", () => {
    expect(decodeAll([encoder.encode("data:  two spaces\n\n")])).toEqual([
      { event: "message", data: " two spaces" },
    ]);
    expect(decodeAll([encoder.encode("data:none\n\n")])).toEqual([
      { event: "message", data: "none" },
    ]);
  });

  it("decodes a multi-byte character split across chunks", () => {
    const bytes = encoder.encode("data: caf\u00E9 \u2192 ok\n\n");
    for (let split = 1; split < bytes.length; split++) {
      const events = decodeAll([bytes.subarray(0, split), bytes.subarray(split)]);
      expect(events).toEqual([{ event: "message", data: "caf\u00E9 \u2192 ok" }]);
    }
  });

  it("strips a byte order mark at the start of the stream", () => {
    expect(decodeAll([encoder.encode("\uFEFFdata: 1\n\n")])).toEqual([
      { event: "message", data: "1" },
    ]);
  });

  it("delivers a final event that lacks its blank line", () => {
    expect(decodeAll([encoder.encode("event: speech.done\ndata: {}")])).toEqual([
      { event: "speech.done", data: "{}" },
    ]);
  });

  it("drops an event that has no data", () => {
    expect(decodeAll([encoder.encode("event: ping\n\nevent: a\ndata: 1\n\n")])).toEqual([
      { event: "a", data: "1" },
    ]);
  });

  it("does not leak an event name into the next event", () => {
    expect(decodeAll([encoder.encode("event: a\ndata: 1\n\ndata: 2\n\n")])).toEqual([
      { event: "a", data: "1" },
      { event: "message", data: "2" },
    ]);
  });
});

describe("readSse", () => {
  function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
    let index = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        onCancel?.();
      },
    });
  }

  it("yields every event of a chunked stream", async () => {
    const events: SseEvent[] = [];
    for await (const event of readSse(streamOf(bytesIn(SAMPLE, 9)))) events.push(event);
    expect(events).toHaveLength(3);
  });

  it("cancels the body when the consumer stops early", async () => {
    let cancelled = false;
    const stream = streamOf(bytesIn(SAMPLE, 200), () => {
      cancelled = true;
    });
    for await (const _event of readSse(stream)) break;
    expect(cancelled).toBe(true);
  });
});
