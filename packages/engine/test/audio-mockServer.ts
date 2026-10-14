export interface RecordedRequest {
  method: string;
  /** Path and query, as a server would see it. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** The slice of a Node ServerResponse the handlers use, backed by an in-memory stream. */
export interface MockResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  write(chunk: string | Uint8Array, callback?: () => void): boolean;
  end(chunk?: string | Uint8Array): void;
  /** Cut the connection: a reader of the body fails. */
  destroy(): void;
}

export type MockHandler = (
  req: RecordedRequest,
  res: MockResponse,
  recorded: RecordedRequest,
  index: number,
) => void | Promise<void>;

export interface MockServer {
  /** A base URL that never resolves anywhere: the requests go to `fetch`. */
  url: string;
  /** Inject as the client's `fetch`. Answers from the handler, in memory, with no socket. */
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

const encoder = new TextEncoder();

/**
 * An in-process fake of the HTTP API. Why not a loopback server: real sockets failed with
 * "fetch failed" in 2 of 6 full-suite runs when the machine was busy, and a test of the client
 * needs the response, not the network.
 */
export function startMockServer(handler: MockHandler): MockServer {
  const requests: RecordedRequest[] = [];
  const doFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    const recorded: RecordedRequest = {
      method: init?.method ?? "GET",
      url: `${target.pathname}${target.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : "",
    };
    const index = requests.push(recorded) - 1;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    let respond!: (response: Response) => void;
    const answered = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    let sent = false;
    let closed = false;
    let status = 200;
    let headers: Record<string, string> = {};
    const send = (): void => {
      if (sent) return;
      sent = true;
      respond(new Response(body, { status, headers }));
    };
    const res: MockResponse = {
      writeHead(code, head = {}) {
        status = code;
        headers = head;
        send();
      },
      write(chunk, callback) {
        send();
        if (!closed) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        callback?.();
        return true;
      },
      end(chunk) {
        if (chunk !== undefined) res.write(chunk);
        send();
        if (!closed) controller.close();
        closed = true;
      },
      destroy() {
        send();
        if (!closed) controller.error(new TypeError("terminated"));
        closed = true;
      },
    };
    Promise.resolve(handler(recorded, res, recorded, index)).catch(() => res.destroy());
    return answered;
  };
  return { url: "http://speechify.test", fetch: doFetch as typeof fetch, requests };
}

export function sseEvent(name: string | undefined, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `${name === undefined ? "" : `event: ${name}\n`}data: ${payload}\n\n`;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Write text in small slices with a tick between, so the client sees many separate chunks. */
export async function writeSliced(res: MockResponse, text: string, size: number): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  for (let offset = 0; offset < bytes.length; offset += size) {
    await new Promise<void>((resolve) =>
      res.write(bytes.subarray(offset, offset + size), () => resolve()),
    );
    await tick();
  }
}

export function startSse(res: MockResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Speechify-Audio-Content-Type": "audio/mpeg",
  });
}

export function jsonError(
  res: MockResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ error: { code, message }, request_id: "req-test-1" }));
}
