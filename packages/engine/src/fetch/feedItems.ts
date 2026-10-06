import type { Source } from "@dispatch/core";
import type { RawItem } from "../normalize/buildItem.js";
import { type FeedEntry, type ParsedFeed, parseFeed } from "./feedParser.js";
import type { FetchDeps } from "./types.js";

const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";

/** Download and parse a feed. Relative links resolve against the final URL after redirects. */
export async function loadFeed(url: string, deps: FetchDeps): Promise<ParsedFeed> {
  const response = await deps.http.fetchText(url, {
    signal: deps.signal,
    headers: { accept: FEED_ACCEPT },
  });
  return parseFeed(response.text, response.url);
}

/** The feed address of a source, or a clear error for a scrape source routed here by mistake. */
export function requireFeedUrl(source: Source): string {
  if (!source.feed_url) throw new Error(`source ${source.id} has no feed_url`);
  return source.feed_url;
}

/** Generic entry mapping shared by RSS, Atom and RDF sources. */
export function entryToRaw(entry: FeedEntry): RawItem {
  return {
    url: entry.link,
    title: entry.title,
    author: entry.author,
    publishedAt: entry.published ?? entry.updated,
    summary: entry.summary ?? entry.mediaDescription,
    content: entry.content,
  };
}
