import type { Item } from "@singularity/core";
import { z } from "zod";
import { type HttpClient, HttpError } from "../http.js";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import { extractEntries } from "./firecrawlExtract.js";
import { type SourceFetcher, SourceSkipped } from "./types.js";

export const FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
/** Cached copies up to this old are accepted; the default of two days would serve last run's page. */
const MAX_AGE_MS = 60 * 60 * 1000;
const SCRAPE_TIMEOUT_MS = 30_000;
/** The failure reason of a listing that returned no items. */
export const FIRECRAWL_NO_ITEMS = "no items";

const ScrapeResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  data: z
    .object({
      markdown: z.string().nullish(),
      rawHtml: z.string().nullish(),
      metadata: z
        .object({
          title: z.union([z.string(), z.array(z.string())]).nullish(),
          statusCode: z.number().nullish(),
          error: z.string().nullish(),
        })
        .partial()
        .optional(),
    })
    .optional(),
});

type ScrapeData = NonNullable<z.infer<typeof ScrapeResponse>["data"]>;

export interface ScrapedPage {
  markdown: string;
  title: string | undefined;
}

/** POST /v2/scrape for one URL in one format; throws on a failed scrape or a 4xx/5xx page. */
async function requestScrape(
  url: string,
  format: "markdown" | "rawHtml",
  config: { apiKey: string; baseUrl?: string | undefined },
  http: HttpClient,
  signal: AbortSignal | undefined,
  retries?: number,
): Promise<ScrapeData> {
  const baseUrl = (config.baseUrl ?? FIRECRAWL_BASE_URL).replace(/\/+$/, "");
  const payload = await http.postJson(
    `${baseUrl}/v2/scrape`,
    {
      url,
      formats: [format],
      ...(format === "markdown" ? { onlyMainContent: true } : {}),
      maxAge: MAX_AGE_MS,
      timeout: SCRAPE_TIMEOUT_MS,
    },
    {
      signal,
      headers: { authorization: `Bearer ${config.apiKey}` },
      timeoutMs: SCRAPE_TIMEOUT_MS + 10_000,
      ...(retries === undefined ? {} : { retries }),
    },
  );
  const parsed = ScrapeResponse.safeParse(payload);
  if (!parsed.success) throw new Error("unexpected Firecrawl response shape");
  const { success, error, data } = parsed.data;
  if (!success || !data) throw new Error(`Firecrawl scrape failed: ${error ?? "no data"}`);
  const status = data.metadata?.statusCode;
  if (typeof status === "number" && status >= 400) throw new Error(`page returned HTTP ${status}`);
  return data;
}

/** POST /v2/scrape for one URL, main content as markdown. */
export async function scrapePage(
  url: string,
  config: { apiKey: string; baseUrl?: string | undefined },
  http: HttpClient,
  signal: AbortSignal | undefined,
): Promise<ScrapedPage> {
  const data = await requestScrape(url, "markdown", config, http, signal);
  const title = data.metadata?.title;
  return {
    markdown: data.markdown ?? "",
    title: Array.isArray(title) ? title[0] : (title ?? undefined),
  };
}

/**
 * One URL's body as served (a feed's XML), not its main content. One request, never retried by
 * the client, so the one the caller took from the run's budget is the one Firecrawl meters.
 */
export async function scrapeRaw(
  url: string,
  config: { apiKey: string; baseUrl?: string | undefined },
  http: HttpClient,
  signal: AbortSignal | undefined,
): Promise<string> {
  const data = await requestScrape(url, "rawHtml", config, http, signal, 0);
  if (!data.rawHtml) throw new Error("Firecrawl scrape failed: no data");
  return data.rawHtml;
}

/**
 * Feedless pages through Firecrawl. Recent entries are pulled out with simple heuristics; when a
 * page yields none, the page itself becomes one item so the judge can decide whether it matters.
 * That fallback has a fixed URL, so it surfaces once per 90-day seen window, not on every run.
 */
export const fetchFirecrawl: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const config = deps.firecrawl;
  if (!config?.apiKey) throw new SourceSkipped("FIRECRAWL_API_KEY is not set");
  const apiKey = config.apiKey;
  const pageUrl = source.feed_url ?? source.url;
  const load = (): Promise<ScrapedPage> =>
    scrapePage(pageUrl, { apiKey, baseUrl: config.baseUrl }, deps.http, deps.signal);
  const guard = config.guard;
  let page: ScrapedPage | null;
  if (guard) {
    try {
      page = await guard.listing(pageUrl, load);
    } catch (error) {
      // The HTTP client already retried with backoff; a 429 that survives counts toward the stop.
      if (error instanceof HttpError && error.status === 429) guard.noteRateLimited();
      throw error;
    }
    if (page === null) {
      throw new SourceSkipped(guard.skipNote);
    }
  } else {
    page = await load();
  }
  const fetchedAt = deps.now();

  const { dated, headings, undated } = extractEntries(page.markdown, pageUrl);
  const items = [
    ...buildItems(dated, { source, window, fetchedAt }),
    ...buildItems(headings, { source, window, fetchedAt, keepFragment: true }),
    ...buildItems(undated, { source, window, fetchedAt, undated: "keep" }),
  ];
  if (items.length > 0) return items;
  // A listing that yields nothing is a failure, so a broken one shows in source health; it used
  // to count as a quiet success (meta-ai-blog fetched 0 for weeks with no failure).
  if (dated.length > 0 || headings.length > 0 || page.markdown.trim() === "") {
    throw new Error(FIRECRAWL_NO_ITEMS);
  }

  const whole: RawItem = {
    url: pageUrl,
    title: page.title ?? source.name,
    summary: page.markdown.replace(/[#*_`>[\]()]/g, " "),
  };
  return buildItems([whole], { source, window, fetchedAt, undated: "keep" });
};
