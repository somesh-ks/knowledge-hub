import type { ApiResult } from "./http";
import { newLimiter, takeSlot, type WindowLimiter } from "./rateLimit";

/**
 * POST /api/report: a page's uncaught error, unhandled rejection or Content-Security-Policy
 * violation, written to the function log as one line so it shows in Vercel's logs and can be
 * searched. Nothing personal is kept: no address, no user agent, and every URL is cut to its path,
 * so a token in a query string never reaches the log. Each instance takes REPORTS_PER_MINUTE; the
 * rest are dropped with 204, so a loop on a page cannot fill the log or the bill.
 */

export const REPORTS_PER_MINUTE = 30;
export const MAX_REPORT_CHARS = 4096;
const FIELD_CHARS = 300;
const KINDS = new Set(["error", "rejection", "csp"]);

export interface ReportDeps {
  log: (line: string) => void;
  now: () => number;
}

const shared = newLimiter();

/**
 * The body as text, or null once it passes `maxBytes`: the stream is cancelled at the cap, so a
 * large upload is never buffered whole.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * The request's body as text, or null when it is too large. A declared length past the cap is
 * refused at once; a missing one (chunked, HTTP/2) is unknown, and the stream is capped as it is read.
 */
export async function readReportBody(
  contentLength: string | null,
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (contentLength !== null && !(Number(contentLength) <= maxBytes)) return null;
  return readCapped(body, maxBytes);
}

/** The path of a URL (or the text itself when it is not one), without query or fragment. */
export function pathOnly(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  try {
    const url = new URL(value, "https://site.invalid");
    const origin = url.origin === "https://site.invalid" ? "" : url.origin;
    return `${origin}${url.pathname}`.slice(0, FIELD_CHARS);
  } catch {
    return value.split(/[?#]/, 1)[0]?.slice(0, FIELD_CHARS) ?? "";
  }
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, FIELD_CHARS) : "";

export function handleReport(
  body: string,
  deps: ReportDeps,
  limiter: WindowLimiter = shared,
): ApiResult<null | { error: string }> {
  if (!takeSlot(limiter, REPORTS_PER_MINUTE, deps.now())) return { status: 204, body: null };
  if (body.length > MAX_REPORT_CHARS) return { status: 413, body: { error: "too_large" } };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (typeof data !== "object" || data === null || !KINDS.has(data.kind as string)) {
    return { status: 400, body: { error: "invalid_report" } };
  }
  const line = {
    kind: data.kind,
    page: pathOnly(data.page),
    message: text(data.message),
    source: pathOnly(data.source),
    line: typeof data.line === "number" ? data.line : undefined,
    directive: text(data.directive),
    blocked: pathOnly(data.blocked),
  };
  deps.log(`[client-fault] ${JSON.stringify(line)}`);
  return { status: 204, body: null };
}
