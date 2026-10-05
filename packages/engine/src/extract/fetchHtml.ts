import { fetchRefusal } from "./urlSafety.js";

export const FETCH_TIMEOUT_MS = 10_000;
/** Pages are capped at 1.5 MB; the rest is dropped, which is plenty for article text. */
export const FETCH_MAX_BYTES = 1_500_000;

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
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const finalUrl = response.url || url;
    const finalRefusal = fetchRefusal(finalUrl);
    if (finalRefusal) return { ok: false, reason: `Redirected: ${finalRefusal}` };
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|xml/i.test(contentType)) {
      return { ok: false, reason: `Not HTML (${contentType || "no content type"}).` };
    }
    const { text, truncated } = await readCapped(response, maxBytes, decoderFor(contentType));
    return { ok: true, html: text, finalUrl, truncated };
  };

  try {
    return await withTimeout(run(), timeoutMs, () => controller.abort());
  } catch (error) {
    if (error instanceof FetchTimeoutError) return { ok: false, reason: error.message };
    return { ok: false, reason: "The request failed." };
  }
}
