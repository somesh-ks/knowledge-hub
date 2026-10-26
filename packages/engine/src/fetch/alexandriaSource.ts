import type { Item } from "@singularity/core";
import { z } from "zod";
import { type BuildContext, buildItems, type RawItem } from "../normalize/buildItem.js";
import type { FetchDeps } from "./types.js";

/** `options.via` value that reads a source through Firecrawl Alexandria's anthropic-com provider. */
export const VIA_ALEXANDRIA_ANTHROPIC = "alexandria:anthropic-com";
const PROVIDER = "anthropic-com";
const CAPABILITY = "company-blog/list_posts";
const TIMEOUT_MS = 30_000;

/** Credits one call costs, from the capability's metadata (find_tools). The reply states the real figure. */
export const ALEXANDRIA_ANTHROPIC_CREDITS = 5;

const Post = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  published_on: z.string().nullish(),
  summary: z.string().nullish(),
  topic: z.string().nullish(),
  news_categories: z.array(z.string()).nullish(),
});

const Reply = z.object({
  success: z.boolean().optional(),
  data: z.object({
    alexandria: z
      .array(
        z.object({
          data: z.object({ posts: z.array(z.unknown()) }).optional(),
          error: z.unknown().optional(),
        }),
      )
      .min(1),
  }),
});

/** Typed `list_posts` rows to the engine's raw items: real dates, no listing-page noise. */
export function postsToRaw(posts: readonly unknown[]): RawItem[] {
  const raws: RawItem[] = [];
  for (const post of posts) {
    const parsed = Post.safeParse(post);
    if (!parsed.success) continue;
    const { title, url, published_on, summary, topic, news_categories } = parsed.data;
    const tags = [topic, ...(news_categories ?? [])].filter((tag): tag is string => !!tag);
    const text = [summary, tags.length > 0 ? `Topics: ${tags.join(", ")}.` : undefined]
      .filter(Boolean)
      .join(" ");
    raws.push({
      url,
      title,
      ...(published_on ? { publishedAt: published_on } : {}),
      ...(text ? { summary: text } : {}),
    });
  }
  return raws;
}

/**
 * One Alexandria `list_posts` call through the Firecrawl client (`POST /v2/scrape` with an
 * `alexandria` body). Throws when the call fails, the capability reports an error or returns no
 * usable posts, so the caller falls back to the ordinary page scrape.
 * `options.category` (engineering, news or research) narrows the listing; without it the provider
 * default applies.
 */
export async function fetchAlexandriaAnthropic(
  source: { options: Record<string, string> },
  context: BuildContext,
  deps: FetchDeps,
  service: { apiKey: string; baseUrl: string },
): Promise<Item[]> {
  const category = source.options.category;
  const body = {
    alexandria: [
      {
        provider: PROVIDER,
        capability: CAPABILITY,
        options: category ? { category } : {},
      },
    ],
  };
  const payload = await deps.http.postJson(
    `${service.baseUrl.replace(/\/+$/, "")}/v2/scrape`,
    body,
    {
      signal: deps.signal,
      headers: { authorization: `Bearer ${service.apiKey}` },
      timeoutMs: TIMEOUT_MS + 10_000,
      retries: 0,
    },
  );
  const reply = Reply.safeParse(payload);
  if (!reply.success) throw new Error("unexpected Alexandria response shape");
  const first = reply.data.data.alexandria[0];
  if (!first || first.error || !first.data) throw new Error("Alexandria list_posts failed");
  const items = buildItems(postsToRaw(first.data.posts), context);
  if (items.length === 0 && first.data.posts.length === 0) {
    throw new Error("Alexandria list_posts returned no posts");
  }
  return items;
}
