/** One dispatched Server-Sent Event. `event` is "message" when the stream sent no `event:` field. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events decoder. Network chunks split events, lines, multi-byte
 * characters and base64 payloads at arbitrary points, so everything is buffered until a line
 * terminator arrives. Follows the WHATWG EventSource parsing rules for the fields Speechify uses.
 */
export class SseDecoder {
  private readonly decoder = new TextDecoder("utf-8");
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private sawFirstChunk = false;

  push(chunk: Uint8Array): SseEvent[] {
    let text = this.decoder.decode(chunk, { stream: true });
    if (!this.sawFirstChunk && text.length > 0) {
      this.sawFirstChunk = true;
      if (text.startsWith("\uFEFF")) text = text.slice(1);
    }
    this.buffer += text;
    return this.drain(false);
  }

  /** Flush at end of stream. A final event without its blank line is delivered, not dropped. */
  end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.drain(true);
    if (this.buffer.length > 0) {
      const last = this.processLine(this.buffer);
      this.buffer = "";
      if (last) events.push(last);
    }
    const tail = this.dispatch();
    if (tail) events.push(tail);
    return events;
  }

  private drain(final: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    const terminator = /\r\n|\n|\r/g;
    let position = 0;
    for (;;) {
      terminator.lastIndex = position;
      const match = terminator.exec(this.buffer);
      if (!match) break;
      const lineEnd = match.index;
      const next = lineEnd + match[0].length;
      // A lone "\r" at the very end may be the first half of "\r\n" split across chunks.
      if (match[0] === "\r" && next === this.buffer.length && !final) break;
      const event = this.processLine(this.buffer.slice(position, lineEnd));
      if (event) events.push(event);
      position = next;
    }
    this.buffer = this.buffer.slice(position);
    return events;
  }

  private processLine(line: string): SseEvent | undefined {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventName = value;
    else if (field === "data") this.dataLines.push(value);
    // `id` and `retry` carry nothing the audio stream needs.
    return undefined;
  }

  private dispatch(): SseEvent | undefined {
    const name = this.eventName;
    const lines = this.dataLines;
    this.eventName = "";
    this.dataLines = [];
    if (lines.length === 0) return undefined;
    return { event: name === "" ? "message" : name, data: lines.join("\n") };
  }
}

/** Read a fetch response body as events. Cancels the body when the consumer stops early. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new SseDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of decoder.push(value)) yield event;
    }
    for (const event of decoder.end()) yield event;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream already finished or errored; there is nothing left to release.
    }
  }
}
