import type { Item } from "@dispatch/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { SourceFetcher } from "./types.js";

export const LOBSTERS_HOTTEST = "https://lobste.rs/hottest.json";

const Story = z.object({
  short_id_url: z.string(),
  created_at: z.string(),
  title: z.string(),
  url: z.string().nullish(),
  score: z.number().nullish(),
  comment_count: z.number().nullish(),
  description_plain: z.string().nullish(),
  // A plain username today; older API versions returned an object.
  submitter_user: z.union([z.string(), z.object({ username: z.string() })]).nullish(),
  user_is_author: z.boolean().nullish(),
});

/** Lobsters hottest list. Ranking is not by date, so the window does the filtering. */
export const fetchLobsters: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const stories = z
    .array(z.unknown())
    .safeParse(
      await deps.http.getJson(source.feed_url ?? LOBSTERS_HOTTEST, { signal: deps.signal }),
    );
  if (!stories.success) throw new Error("unexpected Lobsters response shape");

  const raws: RawItem[] = [];
  for (const candidate of stories.data) {
    const story = Story.safeParse(candidate);
    if (!story.success) continue;
    const { short_id_url, created_at, title, url, score, description_plain, submitter_user } =
      story.data;
    const submitter =
      typeof submitter_user === "string" ? submitter_user : submitter_user?.username;
    raws.push({
      url: url || short_id_url,
      title,
      author: submitter ?? undefined,
      publishedAt: created_at,
      summary: description_plain ?? undefined,
      signals: typeof score === "number" ? { lobsters_score: Math.trunc(score) } : {},
    });
  }
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
