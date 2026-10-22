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
  target.fetch = async (input, init) => {
    const response = await original(input, init);
    try {
      const code = response.status >= 500 ? response.headers.get(PLATFORM_ERROR_HEADER) : null;
      const route = code && CODE.test(code) ? pathOf(input, origin) : null;
      if (code && route && !reported.has(route)) {
        reported.add(route);
        report({ kind: "platform", route, message: code });
      }
    } catch {
      // Watching must never change what the caller gets.
    }
    return response;
  };
}
