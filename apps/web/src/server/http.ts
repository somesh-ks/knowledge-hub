import type { ClientFault } from "@dispatch/engine/faults-store";
import type { APIRoute } from "astro";
import { BUILD_ID } from "../lib/buildId";
import { type FaultWriter, NO_MESSAGE, scrubMessage, storeFault } from "./faults";
import { describeError } from "./redact";

/**
 * A 5xx as the fault store keeps it: the route label, the start of a thrown error's message (or its
 * name), or `status <n>` for one the handler returned, and this deployment's build.
 */
export function serverFault(route: string, status: number, thrown: unknown): ClientFault {
  const scrubbed = thrown instanceof Error ? scrubMessage(thrown.message) : NO_MESSAGE;
  const message =
    thrown === undefined
      ? `status ${status}`
      : scrubbed !== NO_MESSAGE
        ? scrubbed
        : thrown instanceof Error
          ? thrown.name
          : "thrown";
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

/**
 * The one path a 5xx takes to the store. Hobby keeps the function log an hour, so the week's store
 * keeps it too (D158): fire and forget, never holding or failing the answer, nothing of the request.
 */
function keepServerFault(
  record: FaultWriter,
  route: string,
  status: number,
  thrown: unknown,
): void {
  void record(serverFault(route, status, thrown)).catch(() => undefined);
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
  record: FaultWriter = storeFault,
): APIRoute {
  return async (context) => {
    let response: Response;
    try {
      response = await handler(context);
    } catch (error) {
      keepServerFault(record, route, 500, error);
      throw error;
    }
    if (response.status >= 500) keepServerFault(record, route, response.status, undefined);
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
  "GITHUB_DISPATCH_TOKEN",
  "GENERATE_PASSPHRASE_HASH",
  "SPEECHIFY_API_KEY",
  "ANTHROPIC_API_KEY",
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
  let thrown: unknown;
  try {
    result = await run(log);
  } catch (error) {
    thrown = error;
    // The message, redacted, and the line of code that threw: not the whole stack, which can carry
    // request details.
    const at =
      error instanceof Error ? error.stack?.split("\n").find((line) => /^\s+at /.test(line)) : "";
    log(
      `crashed: ${describeError(
        error,
        SECRET_SETTINGS.map((name) => process.env[name]),
      )}${at ? ` (${at.trim()})` : ""}`,
    );
    result = { status: 500, body: { status: 500, error: "server_error" } };
  }
  if (result.status >= 500) keepServerFault(record, route, result.status, thrown);
  if (result.status < 500 || typeof result.body !== "object" || result.body === null) {
    return toResponse(result);
  }
  // Every reference a page shows has at least this line behind it, after any the handler wrote.
  const { error } = result.body as { error?: unknown };
  log(`answered ${result.status}${typeof error === "string" ? ` ${error}` : ""}`);
  return toResponse({ ...result, body: { ...result.body, ref } });
}
