import type { Item } from "@dispatch/core";
import type { Logger } from "../context.js";
import { type FetchHtmlOptions, fetchHtml } from "./fetchHtml.js";
import { articleText, plainTextOf } from "./htmlToText.js";
import { MAX_TEXT_CHARS, truncateAtParagraph } from "./truncate.js";
import { fetchRefusal } from "./urlSafety.js";

/** A source at least this long counts as full text and stops the search for a better one. */
export const MIN_FULL_TEXT_CHARS = 1_000;
/** Below this, text is a teaser or an empty shell and is not worth writing from. */
export const MIN_ACCEPT_CHARS = 200;
/**
 * Text from the feed or the page this long counts as enough: the paid scrape fallback is not
 * called for it, even though it falls short of full text.
 */
export const FEED_TEXT_ENOUGH_CHARS = 600;

export type ExtractMethod = "content" | "snippet" | "readability" | "scrape";

export interface ExtractedText {
  /** Plain text, at most about 10,000 characters, cut at a paragraph boundary. */
  text: string;
  method: ExtractMethod;
  truncated: boolean;
}

/** Firecrawl or any other renderer. Returns Markdown or plain text, or null on failure. */
export type ScrapeFn = (url: string) => Promise<string | null>;

export interface ExtractDeps extends FetchHtmlOptions {
  /** Last resort for JavaScript-heavy or blocked pages. Omit to skip. */
  scrape?: ScrapeFn | null;
  log?: Logger;
  maxChars?: number;
}

/** Light cleanup so scraped Markdown reads as prose: links keep their text, images and markers go. */
export function markdownToText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/^```.*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Candidate {
  text: string;
  method: ExtractMethod;
}

/**
 * Full text for a finalist, cheapest source first:
 *  1. the item's own `content`, if long enough;
 *  2. the feed snippet, if it is already full text;
 *  3. the page HTML (timeout, 1.5 MB cap, http and https only) through Readability;
 *  4. the injected scrape function, for JavaScript-heavy or blocked pages.
 * If nothing reaches full length, the longest candidate over 200 characters is used; otherwise
 * null. The result is plain text cut at a paragraph boundary near 10,000 characters.
 */
export async function extractFullText(
  item: Item,
  deps: ExtractDeps = {},
): Promise<ExtractedText | null> {
  const candidates: Candidate[] = [];
  const finish = (candidate: Candidate): ExtractedText => {
    const cut = truncateAtParagraph(candidate.text, deps.maxChars ?? MAX_TEXT_CHARS);
    return { text: cut.text, method: candidate.method, truncated: cut.truncated };
  };
  const consider = (method: ExtractMethod, raw: string): Candidate | null => {
    const text = raw.trim();
    if (text.length === 0) return null;
    const candidate = { text, method };
    candidates.push(candidate);
    return text.length >= MIN_FULL_TEXT_CHARS ? candidate : null;
  };

  const fromContent = item.content ? consider("content", plainTextOf(item.content)) : null;
  if (fromContent) return finish(fromContent);

  const fromSnippet = item.snippet ? consider("snippet", plainTextOf(item.snippet)) : null;
  if (fromSnippet) return finish(fromSnippet);

  const refusal = fetchRefusal(item.url);
  if (refusal) {
    deps.log?.debug("Skipping page fetch", { itemId: item.id, reason: refusal });
  } else {
    const page = await fetchHtml(item.url, deps);
    if (page.ok) {
      const full = consider("readability", articleText(page.html));
      if (full) return finish(full);
    } else {
      deps.log?.debug("Page fetch failed; trying the scraper", {
        itemId: item.id,
        reason: page.reason,
      });
    }
    // The paid scrape is for pages the free routes could not read. Text this long is enough to write from.
    const longest = candidates.reduce((max, c) => Math.max(max, c.text.length), 0);
    if (deps.scrape && longest < FEED_TEXT_ENOUGH_CHARS) {
      try {
        const markdown = await deps.scrape(item.url);
        const full = markdown ? consider("scrape", markdownToText(markdown)) : null;
        if (full) return finish(full);
      } catch {
        deps.log?.warn("The scraper failed", { itemId: item.id });
      }
    }
  }

  const best = candidates
    .filter((c) => c.text.length >= MIN_ACCEPT_CHARS)
    .sort((a, b) => b.text.length - a.text.length)[0];
  return best ? finish(best) : null;
}
