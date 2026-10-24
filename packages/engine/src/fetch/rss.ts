import type { Item } from "@singularity/core";
import { buildItems } from "../normalize/buildItem.js";
import { entryToRaw, loadFeed, requireFeedUrl } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

/** RSS 2.0, Atom and RDF feeds, including newsletters and blogs. */
export const fetchRss: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const feed = await loadFeed(requireFeedUrl(source), deps);
  return buildItems(feed.entries.map(entryToRaw), {
    source,
    window,
    fetchedAt: deps.now(),
  });
};
