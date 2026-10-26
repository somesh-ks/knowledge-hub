import type { Item } from "@singularity/core";
import { HttpError } from "../http.js";
import { buildItems } from "../normalize/buildItem.js";
import { entryToRaw, loadFeed } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * The channel's uploads playlist (UC becomes UULF: videos, no Shorts or streams) as a feed.
 * YouTube answers `channel_id` feeds with HTTP 404 to datacenter addresses and often still serves
 * this one (2026-10-25: all YouTube sources failed, direct and through Firecrawl).
 */
export function uploadsFeedUrl(channelId: string): string | undefined {
  return /^UC[\w-]{22}$/.test(channelId)
    ? `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`
    : undefined;
}

function channelIdOf(channelId: string | undefined, url: string): string | undefined {
  if (channelId) return channelId;
  try {
    return new URL(url).searchParams.get("channel_id") ?? undefined;
  } catch {
    return undefined;
  }
}

/** YouTube channel feed (videos.xml). Needs a channel id, not a handle. */
export const fetchYoutube: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const channelId = source.options.channel_id;
  const url = source.feed_url ?? (channelId ? channelFeedUrl(channelId) : undefined);
  if (!url) throw new Error(`source ${source.id} needs options.channel_id or feed_url`);
  let feed: Awaited<ReturnType<typeof loadFeed>>;
  try {
    feed = await loadFeed(url, deps);
  } catch (error) {
    const id = channelIdOf(channelId, url);
    const uploads = id ? uploadsFeedUrl(id) : undefined;
    if (!uploads || !(error instanceof HttpError) || error.status !== 404) throw error;
    try {
      feed = await loadFeed(uploads, deps);
    } catch (fallbackError) {
      if (deps.signal?.aborted) throw fallbackError;
      throw error;
    }
  }
  const entries = feed.entries.filter((entry) => !entry.link?.includes("/shorts/"));
  return buildItems(entries.map(entryToRaw), { source, window, fetchedAt: deps.now() });
};
