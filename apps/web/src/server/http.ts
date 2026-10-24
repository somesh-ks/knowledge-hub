import type { ClientFault } from "@singularity/engine/faults-store";
import { waitUntil } from "@vercel/functions";
import type { APIRoute } from "astro";
import { BUILD_ID } from "../lib/buildId";
import { type FaultWriter, NO_MESSAGE, scrubMessage, storeFault } from "./faults";
import { describeError, redact } from "./redact";

/** What made a 5xx: a throw, or an answer whose JSON may name the failed step (`synthesis_failed`). */
export type ServerFaultCause = { thrown: unknown } | { code: unknown };

/** A fixed error code a handler answers with, short and lowercase: it names the step that failed. */
const STEP_CODE = /^[a-z_]{1,40}$/;

/**
 * A 5xx as the fault store keeps it: the route label; for a throw, the start of its message after
 * the log's own redaction of secrets and token shapes (or its name, or `thrown`); for an answer, its
 * step code or `status <n>`; and this deployment's build. Never throws: a getter that throws leaves
 * the plain label.
 */
export function serverFault(route: string, status: number, cause: ServerFaultCause): ClientFault {
  let message = "thrown" in cause ? "thrown" : `status ${status}`;
  try {
    if ("thrown" in cause) {
      const error = cause.thrown;
      if (error instanceof Error) {
        const secrets = SECRET_SETTINGS.map((name) => process.env[name]);
        const start = scrubMessage(redact(String(error.message), secrets));
        const name = scrubMessage(String(error.name));
        message = start !== NO_MESSAGE ? start : name !== NO_MESSAGE ? name : "thrown";
      }
    } else if (typeof cause.code === "string" && STEP_CODE.test(cause.code)) {
      message = cause.code;
    }
  } catch {
    // The label stands.
  }
  return {
    kind: "server",
    page: route,
    message,
    directive: "",
    blocked: "",
    source: "",
    build: BUILD_ID,
  };
}

/** At most one server fault per route a minute per instance, so a burst never crowds out the page's. */
const SERVER_FAULT_GAP_MS = 60_000;
/** Each writer's own last write per route (the site has one writer; a test has its own). */
const lastWrite = new WeakMap<FaultWriter, Map<string, number>>();

/**
 * The one path a 5xx takes to the store. Hobby keeps the function log an hour, so the week's store
 * keeps it too (D158). The write is handed to the platform's `waitUntil`, so a function frozen when
 * its answer returns still finishes it (outside Vercel the promise simply runs); it never holds or
 * fails the answer, and nothing of the request goes in. One a minute per route; the rest are dropped.
 */
function keepServerFault(
  record: FaultWriter,
  route: string,
  status: number,
  cause: () => Promise<ServerFaultCause> | ServerFaultCause,
  now = Date.now(),
): void {
  const seen = lastWrite.get(record) ?? new Map<string, number>();
  lastWrite.set(record, seen);
  if (now - (seen.get(route) ?? Number.NEGATIVE_INFINITY) < SERVER_FAULT_GAP_MS) return;
  seen.set(route, now);
  const work = (async () => {
    await record(serverFault(route, status, await cause()));
  })().catch(() => undefined);
  try {
    waitUntil(work);
  } catch {
    // Not on Vercel: the promise runs on its own.
  }
}

/** The JSON `error` code of an answer, read from a copy so the caller's body is untouched. */
async function answerCode(response: Response): Promise<ServerFaultCause> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return { code: null };
  }
  try {
    const body = (await response.clone().json()) as { error?: unknown } | null;
    return { code: body?.error };
  } catch {
    return { code: null };
  }
}

export interface RecordingOptions {
  /** The writer; the site's store by default. */
  record?: FaultWriter;
  /**
   * Which 5xx are the site's own. A route that fetches a host the caller chose (source-preview,
   * site-icon) answers 502 and 504 for that host, so it keeps only its own 500.
   */
  ours?: (status: number) => boolean;
}

/**
 * Wraps a route that answers for itself (its own body, a stream) so a 5xx it returns, or a throw,
 * is kept as a `server` fault, the same way `answerWithRef` keeps one. The Response is returned
 * unchanged and a throw is rethrown, so the host behaves as before. A stream that fails after its
 * headers went out answered 200 and is not seen here.
 */
export function recordingFaults(
  route: string,
  handler: APIRoute,
  { record = storeFault, ours = () => true }: RecordingOptions = {},
): APIRoute {
  return async (context) => {
    let response: Response;
    try {
      response = await handler(context);
    } catch (error) {
      keepServerFault(record, route, 500, () => ({ thrown: error }));
      throw error;
    }
    if (response.status >= 500 && ours(response.status)) {
      const answered = response;
      keepServerFault(record, route, answered.status, () => answerCode(answered));
    }
    return response;
  };
}

/** What a handler decides: a status, a JSON body and any extra headers. The route turns it into a Response. */
export interface ApiResult<TBody> {
  status: number;
  body: TBody;
  headers?: Record<string, string>;
}

/** Headers every API answer carries. A handler's own headers (a status cache window) override them. */
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function toResponse(result: ApiResult<unknown>): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { ...BASE_HEADERS, ...result.headers },
  });
}

/** The settings whose values a crash message must never print. */
const SECRET_SETTINGS = [
  "GITHUB_SINGULARITY_TOKEN",
  "GITHUB_DISPATCH_TOKEN",
  "SPEECHIFY_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_ADMIN_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "CRON_SECRET",
  "DATABASE_URL",
];

/** Six hex characters: short enough to read out, enough to find one request in a day of logs. */
export function newErrorRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Runs one request of an action route under a reference. Every log line it writes starts with the
 * route and the reference, a thrown error becomes a logged 500 instead of the host's error page, and
 * a server failure (5xx) carries the reference as `ref`, so the page can show it and the owner can
 * search the logs for it. Nothing else of the failure reaches the page.
 */
export async function answerWithRef(
  route: string,
  run: (log: (message: string) => void) => Promise<ApiResult<unknown>>,
  ref: string = newErrorRef(),
  record: FaultWriter = storeFault,
): Promise<Response> {
  const log = (message: string) => console.error(`[${route}] [ref ${ref}] ${message}`);
  let result: ApiResult<unknown>;
  let cause: ServerFaultCause | null = null;
  try {
    result = await run(log);
  } catch (error) {
    cause = { thrown: error };
    // The message, redacted, and the line of code that threw: not the whole stack, which can carry
    // request details.
    // An error whose message or stack getter throws still answers 500 with its reference.
    try {
      const at =
        error instanceof Error ? error.stack?.split("\n").find((line) => /^\s+at /.test(line)) : "";
      log(
        `crashed: ${describeError(
          error,
          SECRET_SETTINGS.map((name) => process.env[name]),
        )}${at ? ` (${at.trim()})` : ""}`,
      );
    } catch {
      log("crashed: an error that could not be described");
    }
    result = { status: 500, body: { status: 500, error: "server_error" } };
  }
  if (result.status >= 500) {
    // A returned 5xx names its step by the fixed code in its body (`synthesis_failed`).
    const body = result.body as { error?: unknown } | null;
    const why: ServerFaultCause = cause ?? {
      code: typeof body === "object" && body !== null ? body.error : null,
    };
    keepServerFault(record, route, result.status, () => why);
  }
  if (result.status < 500 || typeof result.body !== "object" || result.body === null) {
    return toResponse(result);
  }
  // Every reference a page shows has at least this line behind it, after any the handler wrote.
  const { error } = result.body as { error?: unknown };
  log(`answered ${result.status}${typeof error === "string" ? ` ${error}` : ""}`);
  return toResponse({ ...result, body: { ...result.body, ref } });
}
