import type { Item } from "@singularity/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { SourceFetcher } from "./types.js";

const REDDIT = "https://www.reddit.com";
const DEFAULT_MIN_SCORE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A post that passes the score floor later than the fetch that first saw it is still created
 * before this window opened, so the window reaches this far back; seen-item dedupe drops the
 * posts an earlier run already took.
 */
const OVERLAP_MS = DAY_MS;

/** The shortest of Reddit's top-listing periods that reaches back to `from`. */
function periodFor(from: Date, to: Date): "day" | "week" | "month" | "year" {
  const span = to.getTime() - from.getTime();
  if (span <= DAY_MS) return "day";
  if (span <= 7 * DAY_MS) return "week";
  return span <= 30 * DAY_MS ? "month" : "year";
}

const Post = z.object({
  title: z.string(),
  url: z.string().nullish(),
  permalink: z.string(),
  author: z.string().nullish(),
  score: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_utc: z.number(),
  selftext: z.string().nullish(),
  is_self: z.boolean().nullish(),
  over_18: z.boolean().nullish(),
  stickied: z.boolean().nullish(),
});

const Listing = z.object({
  data: z.object({ children: z.array(z.object({ data: z.unknown() })) }),
});

/**
 * A subreddit's top posts for the fetch window (`options.subreddit`; its day, week or month period), at or above a score floor
 * (`options.min_score`). The score and comment count become the story's community votes (D240).
 * Reddit refuses many datacenter addresses (403 or 429): the fetch then fails like any source and
 * the health record shows it, so the source ships off until a run shows it gets through.
 */
export const fetchReddit: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const subreddit = source.options.subreddit;
  if (!subreddit || !/^\w+$/.test(subreddit)) throw new Error("reddit needs options.subreddit");
  const minScore = Number(source.options.min_score ?? DEFAULT_MIN_SCORE);
  // The period follows the window, since a missed run leaves a wider one than a day. Without
  // raw_json=1 Reddit HTML-escapes "&" in every field, which would corrupt a link's query string.
  const reach = { from: new Date(window.from.getTime() - OVERLAP_MS), to: window.to };
  const listing = new URL(source.feed_url ?? `${REDDIT}/r/${subreddit}/top.json`);
  listing.searchParams.set("t", periodFor(reach.from, reach.to));
  listing.searchParams.set("limit", "100");
  listing.searchParams.set("raw_json", "1");
  const body = Listing.safeParse(
    await deps.http.getJson(listing.toString(), { signal: deps.signal }),
  );
  if (!body.success) throw new Error("unexpected Reddit response shape");

  // One URL posted twice in a subreddit is one story: keep the more voted post, not both.
  const byUrl = new Map<string, RawItem>();
  for (const child of body.data.data.children) {
    const post = Post.safeParse(child.data);
    if (!post.success) continue;
    const { title, url, permalink, author, score, num_comments, created_utc, selftext } = post.data;
    if (post.data.stickied || post.data.over_18) continue;
    if (typeof score !== "number" || score < minScore) continue;
    const discussion = `${REDDIT}${permalink}`;
    const target = post.data.is_self || !url ? discussion : url;
    const kept = byUrl.get(target);
    if (kept && (kept.signals?.reddit_score ?? 0) >= score) continue;
    byUrl.set(target, {
      // A text post links to its own thread; a link post to the page it shares.
      url: target,
      title,
      author: author ?? undefined,
      publishedAt: new Date(created_utc * 1000),
      summary: selftext || undefined,
      // A text post is its own story, so its full text is what the writer reads.
      content: post.data.is_self ? selftext || undefined : undefined,
      signals: {
        reddit_score: Math.trunc(score),
        ...(typeof num_comments === "number"
          ? { reddit_comments: Math.max(0, Math.trunc(num_comments)) }
          : {}),
      },
    });
  }
  return buildItems([...byUrl.values()], {
    source,
    window: reach,
    fetchedAt: deps.now(),
  });
};
