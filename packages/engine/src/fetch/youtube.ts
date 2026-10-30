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

/** Videos a feed needs for a median worth comparing against. */
const MIN_VIDEOS_FOR_MEDIAN = 5;

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * A video's views as vote-equivalents against its own channel: views are not comparable across
 * channels (a million-subscriber channel's dull video beats a small channel's best), so the
 * measure is the multiple of the channel's median. A line through 3 times the median = 500 and
 * 10 times = 1500 (the community score's own scale), floored at 0 below about 1.6 times.
 */
export function youtubeVotes(views: number, median: number): number {
  if (median <= 0) return 0;
  return Math.max(0, Math.round(830 * Math.log(views / median) - 410));
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
  const counted = feed.entries.flatMap((entry) => (entry.views === undefined ? [] : [entry.views]));
  const median = counted.length >= MIN_VIDEOS_FOR_MEDIAN ? medianOf(counted) : undefined;
  const raws = entries.map((entry) => ({
    ...entryToRaw(entry),
    signals: {
      ...(source.high_signal ? { creator_vetted: true } : {}),
      ...(entry.views === undefined ? {} : { youtube_views: entry.views }),
      ...(entry.views === undefined || median === undefined
        ? {}
        : { youtube_votes: youtubeVotes(entry.views, median) }),
    },
  }));
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
