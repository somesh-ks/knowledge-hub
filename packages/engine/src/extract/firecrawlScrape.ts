import { z } from "zod";
import type { ScrapeFn } from "./extractText.js";
import { fetchRefusal } from "./urlSafety.js";

const FIRECRAWL_BASE = "https://api.firecrawl.dev";
/** The free plan allows 10 requests a minute and 2 concurrent; one call per 6 seconds stays under it. */
const MIN_INTERVAL_MS = 6_000;
const TIMEOUT_MS = 45_000;

const ScrapeReply = z.object({
  success: z.boolean(),
  data: z.object({ markdown: z.string().optional() }).optional(),
});

export interface FirecrawlScrapeOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  /** Injected so tests never wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Last-resort page text through Firecrawl `POST /v2/scrape` (renders JavaScript, main content
 * only, Markdown). Calls are serialized and spaced to stay inside the free plan's rate limit.
 * Any failure returns null, so extraction falls back to whatever text it already has.
 */
export function createFirecrawlScrape(options: FirecrawlScrapeOptions): ScrapeFn {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  let chain: Promise<unknown> = Promise.resolve();
  let lastCallAt = Number.NEGATIVE_INFINITY;

  const scrapeOne = async (url: string): Promise<string | null> => {
    if (fetchRefusal(url)) return null;
    const wait = lastCallAt + interval - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
    try {
      const response = await fetchImpl(`${FIRECRAWL_BASE}/v2/scrape`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const parsed = ScrapeReply.safeParse(await response.json());
      return parsed.success && parsed.data.success ? (parsed.data.data?.markdown ?? null) : null;
    } catch {
      return null;
    }
  };

  return (url) => {
    const result = chain.then(() => scrapeOne(url));
    chain = result.catch(() => null);
    return result;
  };
}
