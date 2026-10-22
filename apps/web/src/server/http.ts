import { describeError } from "./redact";

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
): Promise<Response> {
  const log = (message: string) => console.error(`[${route}] [ref ${ref}] ${message}`);
  let result: ApiResult<unknown>;
  try {
    result = await run(log);
  } catch (error) {
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
  if (result.status < 500 || typeof result.body !== "object" || result.body === null) {
    return toResponse(result);
  }
  // Every reference a page shows has at least this line behind it, after any the handler wrote.
  const { error } = result.body as { error?: unknown };
  log(`answered ${result.status}${typeof error === "string" ? ` ${error}` : ""}`);
  return toResponse({ ...result, body: { ...result.body, ref } });
}
