import {
  assertPublicHost,
  type FetchImpl,
  parseTargetUrl,
  type Resolver,
  resolveAll,
} from "./sourcePreview";

/**
 * GET /api/site-icon?url=: a site's icon or thumbnail, fetched by the function so the page never
 * loads an image from a host it does not control (the Content-Security-Policy stays at 'self').
 *
 * It fetches an address a stranger chose, so it uses the source preview's guard: https on the default
 * port only, no credentials, every resolved address public. A redirect is followed only to the same
 * host, and each hop is checked again. Only `image/*` answers pass, at most 256 KB, within 5 seconds.
 * Anything else, for any reason, is a 404: the page falls back to a letter.
 */

export const MAX_ICON_BYTES = 256 * 1024;
export const ICON_TIMEOUT_MS = 5000;
const MAX_HOPS = 3;

export interface SiteIconDeps {
  fetch: FetchImpl;
  resolve?: Resolver;
  /** Replaced in tests. */
  timeoutMs?: number;
}

export interface SiteIconResult {
  status: 200 | 404;
  bytes?: Uint8Array;
  contentType?: string;
}

const NOT_FOUND: SiteIconResult = { status: 404 };

/** Reads a body up to a limit; null when it is longer. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function handleSiteIcon(
  rawUrl: string | null,
  deps: SiteIconDeps,
): Promise<SiteIconResult> {
  const resolve = deps.resolve ?? resolveAll;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? ICON_TIMEOUT_MS);
  try {
    if (rawUrl === null) return NOT_FOUND;
    let url = parseTargetUrl(rawUrl);
    const host = url.hostname;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      await assertPublicHost(url, resolve);
      const response = await deps.fetch(url.toString(), {
        redirect: "manual",
        signal,
        headers: { Accept: "image/*" },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        const next = parseTargetUrl(new URL(location, url).toString());
        if (next.hostname !== host) return NOT_FOUND;
        url = next;
        continue;
      }
      if (!response.ok) return NOT_FOUND;
      const contentType = response.headers.get("content-type") ?? "";
      if (!/^image\//i.test(contentType)) {
        await response.body?.cancel();
        return NOT_FOUND;
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_ICON_BYTES) {
        await response.body?.cancel();
        return NOT_FOUND;
      }
      const bytes = await readCapped(response, MAX_ICON_BYTES);
      if (!bytes || bytes.byteLength === 0) return NOT_FOUND;
      return { status: 200, bytes, contentType };
    }
    return NOT_FOUND;
  } catch {
    return NOT_FOUND;
  }
}

/** The answer as a Response. An SVG can carry script, so the answer is sandboxed and never sniffed. */
export function iconResponse(result: SiteIconResult): Response {
  if (result.status !== 200 || !result.bytes) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(result.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": result.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
