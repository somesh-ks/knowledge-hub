import type { Item } from "@singularity/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { SourceFetcher } from "./types.js";

const REDDIT = "https://www.reddit.com";
const DEFAULT_MIN_SCORE = 50;

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
 * A subreddit's best posts of the day (`options.subreddit`), above a score floor
 * (`options.min_score`). The score and comment count become the story's community votes (D240).
 * Reddit refuses many datacenter addresses (403 or 429): the fetch then fails like any source and
 * the health record shows it, so the source ships off until a run shows it gets through.
 */
export const fetchReddit: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const subreddit = source.options.subreddit;
  if (!subreddit || !/^\w+$/.test(subreddit)) throw new Error("reddit needs options.subreddit");
  const minScore = Number(source.options.min_score ?? DEFAULT_MIN_SCORE);
  const base = source.feed_url ?? `${REDDIT}/r/${subreddit}/top.json?t=day&limit=100`;
  const body = Listing.safeParse(await deps.http.getJson(base, { signal: deps.signal }));
  if (!body.success) throw new Error("unexpected Reddit response shape");

  const raws: RawItem[] = [];
  for (const child of body.data.data.children) {
    const post = Post.safeParse(child.data);
    if (!post.success) continue;
    const { title, url, permalink, author, score, num_comments, created_utc, selftext } = post.data;
    if (post.data.stickied || post.data.over_18) continue;
    if (typeof score !== "number" || score < minScore) continue;
    const discussion = `${REDDIT}${permalink}`;
    raws.push({
      // A text post links to its own thread; a link post to the page it shares.
      url: post.data.is_self || !url ? discussion : url,
      title,
      author: author ?? undefined,
      publishedAt: new Date(created_utc * 1000),
      summary: selftext || undefined,
      signals: {
        reddit_score: Math.trunc(score),
        ...(typeof num_comments === "number"
          ? { reddit_comments: Math.max(0, Math.trunc(num_comments)) }
          : {}),
      },
    });
  }
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
