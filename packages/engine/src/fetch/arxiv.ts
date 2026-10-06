import type { Item } from "@dispatch/core";
import { buildItems } from "../normalize/buildItem.js";
import { entryToRaw, loadFeed } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

export const ARXIV_API = "https://export.arxiv.org/api/query";
const DEFAULT_CATEGORY = "cs.HC";
const DEFAULT_MAX_RESULTS = 100;

export function arxivQueryUrl(category: string, maxResults: number): string {
  // The query endpoint is used rather than the RSS feed, which only announces on weekdays.
  const params = new URLSearchParams({
    search_query: `cat:${category}`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(maxResults),
  });
  return `${ARXIV_API}?${params.toString()}`;
}

/** Abstract-page link without the version suffix, so a revised paper keeps its identity. */
export function unversionedArxivUrl(url: string | undefined): string | undefined {
  return url
    ?.replace(/(arxiv\.org\/abs\/[^/?#]+?)v\d+(?=$|[?#])/i, "$1")
    .replace(/^http:/, "https:");
}

/** arXiv preprints for one category, newest submissions first. One request per run (3 s etiquette). */
export const fetchArxiv: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const category = source.options.category ?? DEFAULT_CATEGORY;
  const maxResults = Number(source.options.max_results) || DEFAULT_MAX_RESULTS;
  const feed = await loadFeed(arxivQueryUrl(category, maxResults), deps);
  const raws = feed.entries.map((entry) => {
    const raw = entryToRaw(entry);
    // `published` is the first version's date; `updated` moves with every revision.
    return { ...raw, url: unversionedArxivUrl(entry.link), publishedAt: entry.published };
  });
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
