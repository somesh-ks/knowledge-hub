import type { Item } from "@dispatch/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { ExaQuery } from "./queries.js";
import { type FetchDeps, type FetchWindow, type SourceFetcher, SourceSkipped } from "./types.js";

export const EXA_BASE_URL = "https://api.exa.ai";
const RESULTS_PER_QUERY = 10;
const HIGHLIGHT_CHARS = 600;
const QUERY_CONCURRENCY = 3;

const ExaResult = z.object({
  title: z.string().nullish(),
  url: z.string(),
  publishedDate: z.string().nullish(),
  author: z.string().nullish(),
  highlights: z.array(z.string()).nullish(),
  text: z.string().nullish(),
});
const ExaResponse = z.object({ results: z.array(z.unknown()) });

/** Request body for POST /search. Freshness comes from the window, not from words in the query. */
export function exaSearchBody(query: ExaQuery, window: FetchWindow): Record<string, unknown> {
  return {
    query: query.query,
    type: "auto",
    numResults: RESULTS_PER_QUERY,
    startPublishedDate: window.from.toISOString(),
    ...(query.include_domains?.length ? { includeDomains: query.include_domains } : {}),
    contents: { highlights: { maxCharacters: HIGHLIGHT_CHARS } },
  };
}

export function parseExaResults(payload: unknown): RawItem[] {
  const body = ExaResponse.safeParse(payload);
  if (!body.success) throw new Error("unexpected Exa response shape");
  const raws: RawItem[] = [];
  for (const candidate of body.data.results) {
    const result = ExaResult.safeParse(candidate);
    if (!result.success) continue;
    const { title, url, publishedDate, author, highlights, text } = result.data;
    raws.push({
      url,
      title: title ?? undefined,
      author: author ?? undefined,
      publishedAt: publishedDate ?? undefined,
      summary: highlights?.join(" ") || undefined,
      content: text ?? undefined,
    });
  }
  return raws;
}

async function searchOne(
  query: ExaQuery,
  window: FetchWindow,
  apiKey: string,
  baseUrl: string,
  deps: FetchDeps,
): Promise<RawItem[]> {
  const payload = await deps.http.postJson(`${baseUrl}/search`, exaSearchBody(query, window), {
    signal: deps.signal,
    headers: { "x-api-key": apiKey },
  });
  return parseExaResults(payload);
}

/**
 * Semantic discovery through Exa. Each query in config/queries.json is one search. A failed query
 * is dropped; only when every query fails does the source fail. Skips cleanly without a key.
 */
export const fetchExa: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const config = deps.exa;
  if (!config?.apiKey) throw new SourceSkipped("EXA_API_KEY is not set");
  if (config.queries.length === 0) throw new SourceSkipped("no queries in config/queries.json");
  const baseUrl = (config.baseUrl ?? EXA_BASE_URL).replace(/\/+$/, "");
  const apiKey = config.apiKey;

  const results: (RawItem[] | Error)[] = new Array(config.queries.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const query = config.queries[index];
      if (!query) return;
      try {
        results[index] = await searchOne(query, window, apiKey, baseUrl, deps);
      } catch (error) {
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(QUERY_CONCURRENCY, config.queries.length) }, () => worker()),
  );

  const failures = results.filter((r): r is Error => r instanceof Error);
  if (failures.length === results.length) {
    throw new Error(`every Exa query failed: ${failures[0]?.message ?? "unknown error"}`);
  }
  const raws = results.flatMap((r) => (r instanceof Error ? [] : r));
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
