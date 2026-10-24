import type { Item } from "@singularity/core";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import { htmlToText } from "../normalize/htmlToText.js";
import { loadFeed, requireFeedUrl } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

/**
 * Product Hunt's Atom feed. The title is only the product name and the content starts with the
 * tagline, so the tagline becomes the snippet and the "Discussion | Link" footer is dropped.
 */
export const fetchProductHunt: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const feed = await loadFeed(requireFeedUrl(source), deps);
  const raws: RawItem[] = feed.entries.map((entry) => {
    const tagline = htmlToText(entry.content ?? entry.summary ?? "").split("\n")[0] ?? "";
    return {
      url: entry.link,
      title: entry.title,
      author: entry.author,
      publishedAt: entry.published ?? entry.updated,
      summary: tagline,
    };
  });
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
