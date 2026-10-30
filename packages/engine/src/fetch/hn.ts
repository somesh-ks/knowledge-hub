import type { Item } from "@singularity/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { SourceFetcher } from "./types.js";

export const HN_SEARCH_BY_DATE = "https://hn.algolia.com/api/v1/search_by_date";
const DEFAULT_TAGS = "show_hn";
const DEFAULT_MIN_POINTS = 30;

const HnHit = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_at_i: z.number(),
  story_text: z.string().nullish(),
});

const HnResponse = z.object({ hits: z.array(z.unknown()) });

export function hnQueryUrl(
  base: string,
  tags: string,
  minPoints: number,
  fromSeconds: number,
  query?: string,
): string {
  const params = new URLSearchParams({
    tags,
    numericFilters: `points>${minPoints},created_at_i>${fromSeconds}`,
    hitsPerPage: "100",
  });
  // Any one word may match, so a topic's words find its stories; the points floor keeps the noise out.
  if (query) {
    params.set("query", query);
    params.set("optionalWords", query);
  }
  return `${base}?${params.toString()}`;
}

/**
 * Hacker News through Algolia: recent posts above a points floor. Show HN by default; a source
 * with `options.query` takes the stories about its words instead (`options.tags: story`), so the
 * community's own discussion of a topic reaches the pool (D240).
 */
export const fetchHn: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const tags = source.options.tags ?? DEFAULT_TAGS;
  const minPoints = Number(source.options.min_points ?? DEFAULT_MIN_POINTS);
  const base = source.feed_url ?? HN_SEARCH_BY_DATE;
  const fromSeconds = Math.floor(window.from.getTime() / 1000);
  const query = source.options.query?.trim() || undefined;
  const body = HnResponse.safeParse(
    await deps.http.getJson(hnQueryUrl(base, tags, minPoints, fromSeconds, query), {
      signal: deps.signal,
    }),
  );
  if (!body.success) throw new Error("unexpected Hacker News response shape");

  const raws: RawItem[] = [];
  for (const candidate of body.data.hits) {
    const hit = HnHit.safeParse(candidate);
    if (!hit.success) continue;
    const { objectID, title, url, author, points, num_comments, created_at_i, story_text } =
      hit.data;
    raws.push({
      // Text-only posts have no link, so the discussion page stands in.
      url: url || `https://news.ycombinator.com/item?id=${objectID}`,
      title: title ?? undefined,
      author: author ?? undefined,
      publishedAt: new Date(created_at_i * 1000),
      summary: story_text ?? undefined,
      signals: {
        ...(typeof points === "number" ? { hn_points: Math.max(0, Math.trunc(points)) } : {}),
        ...(typeof num_comments === "number"
          ? { hn_comments: Math.max(0, Math.trunc(num_comments)) }
          : {}),
      },
    });
  }
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
