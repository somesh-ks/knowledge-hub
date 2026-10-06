import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type MockHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  recorded: RecordedRequest,
  index: number,
) => void | Promise<void>;

export interface MockServer {
  /** Base URL such as http://127.0.0.1:41234 */
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** An in-process HTTP server on a random loopback port. No traffic leaves the machine. */
export async function startMockServer(handler: MockHandler): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      const index = requests.push(recorded) - 1;
      Promise.resolve(handler(req, res, recorded, index)).catch(() => {
        res.destroy();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function sseEvent(name: string | undefined, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `${name === undefined ? "" : `event: ${name}\n`}data: ${payload}\n\n`;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Write text in small slices with a tick between, so TCP delivers it as many separate chunks. */
export async function writeSliced(res: ServerResponse, text: string, size: number): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  for (let offset = 0; offset < bytes.length; offset += size) {
    await new Promise<void>((resolve) =>
      res.write(bytes.subarray(offset, offset + size), () => resolve()),
    );
    await tick();
  }
}

export function startSse(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Speechify-Audio-Content-Type": "audio/mpeg",
  });
  res.socket?.setNoDelay(true);
}

export function jsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ error: { code, message }, request_id: "req-test-1" }));
}
