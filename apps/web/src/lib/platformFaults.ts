/**
 * Functions Vercel kills (a timeout, a crash) never reach the server's own fault recording
 * (server/http.ts): Vercel answers the page itself, a 5xx with an `x-vercel-error` code such as
 * FUNCTION_INVOCATION_TIMEOUT (504) or FUNCTION_INVOCATION_FAILED (500). Only the page sees that
 * answer, so the page reports it (D158, kind `platform`), once per route a page load.
 *
 * The page scripts call `/api/*` from thirteen files with no shared helper, so this watches
 * `fetch` itself, in one place (scripts/app.ts). It only looks: the request and the Response are
 * passed through untouched, and nothing it does can throw into a caller. A 5xx the site's own code
 * answered carries no `x-vercel-error`, so it is never counted twice.
 */

/** The header Vercel sets on an answer it gave instead of the function. */
export const PLATFORM_ERROR_HEADER = "x-vercel-error";
const CODE = /^[A-Z_]{3,60}$/;

export interface PlatformFault {
  kind: "platform";
  /** The API route's path, never its query. */
  route: string;
  /** Vercel's error code. */
  message: string;
}

function pathOf(input: RequestInfo | URL, origin: string): string | null {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, origin);
  return url.origin === origin && url.pathname.startsWith("/api/") ? url.pathname : null;
}

/** Wraps `target.fetch` so a platform 5xx on a same-origin `/api` route is reported once. */
export function watchPlatformFaults(
  target: { fetch: typeof fetch },
  origin: string,
  report: (fault: PlatformFault) => void,
): void {
  const original = target.fetch.bind(target);
  const reported = new Set<string>();
  const send = (route: string, code: string) => {
    if (reported.has(route)) return;
    reported.add(route);
    report({ kind: "platform", route, message: code });
  };
  target.fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const route = response.status >= 500 ? pathOf(input, origin) : null;
      const header = route ? response.headers.get(PLATFORM_ERROR_HEADER) : null;
      if (route && header && CODE.test(header)) {
        send(route, header);
      } else if (route && !header && PAGE_TYPES.test(response.headers.get("content-type") ?? "")) {
        // No header (Vercel's docs never name one): its error page prints the code on a line of
        // its own. Read from a copy, off the caller's path; our own answers are JSON, never read.
        void codeInPage(response.clone())
          .then((code) => code && send(route, code))
          .catch(() => undefined);
      }
    } catch {
      // Watching must never change what the caller gets.
    }
    return response;
  };
}

/** Vercel's error page is plain text or HTML; the site's own handled answers are JSON. */
const PAGE_TYPES = /^text\/(plain|html)\b/i;
/** The code line on Vercel's error page ("FUNCTION_INVOCATION_TIMEOUT"). */
const PAGE_CODE =
  /^(FUNCTION_[A-Z_]{3,50}|[A-Z_]*TIMEOUT|NO_RESPONSE_FROM_FUNCTION|EDGE_FUNCTION_INVOCATION_[A-Z_]+)$/;
/** An error page is short; past this nothing more is read. */
const PAGE_BYTES = 2048;

/** The first code line in the first PAGE_BYTES of an error page, or null. */
async function codeInPage(copy: Response): Promise<string | null> {
  const reader = copy.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  const line = text
    .slice(0, PAGE_BYTES)
    .split(/\r?\n/)
    .map((each) => each.trim())
    .find((each) => PAGE_CODE.test(each));
  return line ?? null;
}
