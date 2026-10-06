import { fetchRefusal } from "./urlSafety.js";

export const FETCH_TIMEOUT_MS = 10_000;
/** Pages are capped at 1.5 MB; the rest is dropped, which is plenty for article text. */
export const FETCH_MAX_BYTES = 1_500_000;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const USER_AGENT = "Mozilla/5.0 (compatible; DispatchBot/1.0; private briefing)";

export interface FetchHtmlOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export type FetchHtmlResult =
  | { ok: true; html: string; finalUrl: string; truncated: boolean }
  | { ok: false; reason: string };

class FetchTimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new FetchTimeoutError(`No response within ${ms} ms.`));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function decoderFor(contentType: string): TextDecoder {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

/** Read at most `maxBytes`, then stop pulling from the network. */
async function readCapped(
  response: Response,
  maxBytes: number,
  decoder: TextDecoder,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: decoder.decode(joined), truncated };
}

/**
 * GET a page as HTML with a timeout and a byte cap. Never throws: a refusal, an HTTP error, a
 * non-HTML type or a timeout comes back as `{ ok: false, reason }` so the caller can fall back.
 * Only http and https are fetched, and private or local hosts are refused, including after redirects.
 */
export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {},
): Promise<FetchHtmlResult> {
  const refusal = fetchRefusal(url);
  if (refusal) return { ok: false, reason: refusal };
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  const controller = new AbortController();

  const run = async (): Promise<FetchHtmlResult> => {
    // Redirects are followed by hand so every hop is checked before it is requested. Letting
    // fetch follow them would send the request to a private address and only then tell us.
    let current = url;
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location) return { ok: false, reason: `HTTP ${response.status} without a location.` };
        if (hop >= MAX_REDIRECTS) return { ok: false, reason: "Too many redirects." };
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return { ok: false, reason: "The redirect location is not a valid URL." };
        }
        const hopRefusal = fetchRefusal(next);
        if (hopRefusal) return { ok: false, reason: `Redirected: ${hopRefusal}` };
        current = next;
        continue;
      }
      // Defense in depth for a fetch that already followed redirects itself (a proxy, a test fake).
      const landed = response.url || current;
      const landedRefusal = fetchRefusal(landed);
      if (landedRefusal) return { ok: false, reason: `Redirected: ${landedRefusal}` };
      if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
      const contentType = response.headers.get("content-type") ?? "";
      if (!/html|xml/i.test(contentType)) {
        return { ok: false, reason: `Not HTML (${contentType || "no content type"}).` };
      }
      const { text, truncated } = await readCapped(response, maxBytes, decoderFor(contentType));
      return { ok: true, html: text, finalUrl: landed, truncated };
    }
  };

  try {
    return await withTimeout(run(), timeoutMs, () => controller.abort());
  } catch (error) {
    if (error instanceof FetchTimeoutError) return { ok: false, reason: error.message };
    return { ok: false, reason: "The request failed." };
  }
}
