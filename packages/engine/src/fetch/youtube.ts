import type { Item } from "@singularity/core";
import { buildItems } from "../normalize/buildItem.js";
import { entryToRaw, loadFeed } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/** YouTube channel feed (videos.xml). Needs a channel id, not a handle. */
export const fetchYoutube: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const channelId = source.options.channel_id;
  const url = source.feed_url ?? (channelId ? channelFeedUrl(channelId) : undefined);
  if (!url) throw new Error(`source ${source.id} needs options.channel_id or feed_url`);
  const feed = await loadFeed(url, deps);
  const entries = feed.entries.filter((entry) => !entry.link?.includes("/shorts/"));
  return buildItems(entries.map(entryToRaw), { source, window, fetchedAt: deps.now() });
};
