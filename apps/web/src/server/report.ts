import { VITAL_MAX, VITAL_METRICS, type VitalSample } from "@dispatch/core";
import type { ApiResult } from "./http";
import { newLimiter, takeSlot, type WindowLimiter } from "./rateLimit";

/**
 * POST /api/report: a page's uncaught error, unhandled rejection or Content-Security-Policy
 * violation, written to the function log as one line so it shows in Vercel's logs and can be
 * searched. Nothing personal is kept: no address, no user agent, and every URL is cut to its path,
 * so a token in a query string never reaches the log. Each instance takes REPORTS_PER_MINUTE; the
 * rest are dropped with 204, so a loop on a page cannot fill the log or the bill.
 *
 * A `vitals` report (scripts/vitals.ts) carries a page load's LCP, INP and CLS. It is not logged:
 * it goes to `deps.vital`, which keeps it where `dispatch health` reads it (vitalsStore.ts).
 */

export const REPORTS_PER_MINUTE = 30;
export const MAX_REPORT_CHARS = 4096;
const FIELD_CHARS = 300;
const KINDS = new Set(["error", "rejection", "csp", "vitals"]);

export interface ReportDeps {
  log: (line: string) => void;
  now: () => number;
  /** Keeps a page load's Web Vitals; absent, they are dropped. */
  vital?: (sample: VitalSample) => Promise<void>;
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

/** A page load's vitals, or null when no metric is a number in its plausible range. */
export function readVital(data: Record<string, unknown>, at: number): VitalSample | null {
  const sample: VitalSample = { at, page: pathOnly(data.page) };
  for (const metric of VITAL_METRICS) {
    const value = data[metric];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      if (value > VITAL_MAX[metric]) return null;
      sample[metric] = Math.round(value * 10_000) / 10_000;
    }
  }
  return VITAL_METRICS.some((metric) => sample[metric] !== undefined) ? sample : null;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, FIELD_CHARS) : "";

export function handleReport(
  body: string,
  deps: ReportDeps,
  limiter: WindowLimiter = shared,
): ApiResult<null | { error: string }> & { work?: Promise<void> } {
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
  if (data.kind === "vitals") {
    const sample = readVital(data, deps.now());
    if (sample === null) return { status: 400, body: { error: "invalid_report" } };
    return { status: 204, body: null, ...(deps.vital ? { work: deps.vital(sample) } : {}) };
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
