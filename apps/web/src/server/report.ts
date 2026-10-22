import { type FaultWriter, parseClientFault } from "./faults";
import type { ApiResult } from "./http";
import { newLimiter, takeSlot, type WindowLimiter } from "./rateLimit";
import { parseVitals, type VitalsWriter } from "./vitals";

/**
 * POST /api/report: a page's uncaught error, unhandled rejection or Content-Security-Policy
 * violation, written to the function log as one line so it shows in Vercel's logs and can be
 * searched, and kept for a week in the store (server/faults.ts, D158), where `dispatch health`
 * reads it: Hobby keeps the log an hour. Nothing personal is kept: no address, no user agent, and
 * every URL is cut to its path (the store keeps less: a route template and an origin), so a token
 * in a query string never reaches either. Each instance takes REPORTS_PER_MINUTE; the
 * rest are dropped with 204, so a loop on a page cannot fill the log or the bill.
 *
 * A `vitals` report (D156) is a page's field Web Vitals: it goes to the store (server/vitals.ts),
 * never to the log, and takes its own VITALS_PER_MINUTE, so a busy hour of page loads never crowds
 * out a fault. Every answer is 204: a beacon is never failed for what the store did.
 */

export const REPORTS_PER_MINUTE = 30;
export const VITALS_PER_MINUTE = 30;
export const MAX_REPORT_CHARS = 4096;
const FIELD_CHARS = 300;
const KINDS = new Set(["error", "rejection", "csp", "platform"]);

export interface ReportDeps {
  log: (line: string) => void;
  now: () => number;
  /** Where a page's vitals go; without it they are dropped. */
  storeVitals?: VitalsWriter;
  /** Where a page's faults are kept (D158); without it they reach only the log. */
  storeFault?: FaultWriter;
}

/** Each instance's own windows: faults and vitals counted apart. */
export interface ReportLimiters {
  faults: WindowLimiter;
  vitals: WindowLimiter;
}

const shared: ReportLimiters = { faults: newLimiter(), vitals: newLimiter() };

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

export async function handleReport(
  body: string,
  deps: ReportDeps,
  limiters: ReportLimiters = shared,
): Promise<ApiResult<null | { error: string }>> {
  if (body.length > MAX_REPORT_CHARS) return { status: 413, body: { error: "too_large" } };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (typeof data !== "object" || data === null || typeof data.kind !== "string") {
    return { status: 400, body: { error: "invalid_report" } };
  }
  if (data.kind === "vitals") {
    // An old bundle's shape (D146's) names no device class, so it is dropped unstored.
    const vitals = parseVitals(data);
    if (vitals && deps.storeVitals && takeSlot(limiters.vitals, VITALS_PER_MINUTE, deps.now())) {
      await deps.storeVitals(vitals);
    }
    return { status: 204, body: null };
  }
  // A kind this build does not log is answered before it spends a slot.
  if (!KINDS.has(data.kind)) return { status: 204, body: null };
  if (!takeSlot(limiters.faults, REPORTS_PER_MINUTE, deps.now())) {
    return { status: 204, body: null };
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
  // The log lasts an hour on Hobby; the store keeps the week health reads (D158).
  const fault = parseClientFault(data);
  if (fault && deps.storeFault) await deps.storeFault(fault);
  return { status: 204, body: null };
}
