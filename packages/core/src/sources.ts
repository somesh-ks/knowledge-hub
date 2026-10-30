import { z } from "zod";
import { Category, IdString } from "./categories.js";
import { SourceType } from "./item.js";

const isoDateTime = z.string().datetime({ offset: true });

/** What kind of publication a source is. Company and lab announcements are `blog`. */
export const SOURCE_FORMATS = [
  "blog",
  "news",
  "forum",
  "video",
  "research",
  "releases",
  "podcast",
] as const;
export const SourceFormat = z.enum(SOURCE_FORMATS);
export type SourceFormat = z.infer<typeof SourceFormat>;

/** The format the type decides by itself; anything else reads as a blog until Jev or a person says otherwise. */
export function deriveSourceFormat(type: SourceType): SourceFormat {
  switch (type) {
    case "youtube":
      return "video";
    case "github":
    case "producthunt":
      return "releases";
    case "arxiv":
    case "crossref":
      return "research";
    case "hn":
    case "lobsters":
    case "reddit":
      return "forum";
    default:
      return "blog";
  }
}

/** A source's format: the one it carries, else the rule's. Old files without the field read the same as new ones. */
export function sourceFormat(source: {
  type: SourceType;
  format?: SourceFormat | undefined;
}): SourceFormat {
  return source.format ?? deriveSourceFormat(source.type);
}

/** One entry of config/sources.json, generated from config/Sources.md plus feed discovery. */
export const Source = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: SourceType,
  /** Optional in the file so older configs parse; read it through `sourceFormat`, which falls back to the type's rule. */
  format: SourceFormat.optional(),
  /**
   * A general news source's political lean, -2 (Left) to 2 (Right); null or absent is unrated and
   * counts as Centre. Rated once by Jev (`classify-lean`), editable in the source panel.
   */
  lean: z.number().int().min(-2).max(2).nullable().optional(),
  /** Human-facing page. */
  url: z.string().url(),
  /** Machine feed or API URL. Null when none was found (a scrape source). */
  feed_url: z.string().url().nullable(),
  /** "daily" sources run every digest; "weekly" sources only in the Sunday pass. */
  tier: z.enum(["daily", "weekly"]),
  high_signal: z.boolean(),
  category_hint: Category.optional(),
  enabled: z.boolean().default(true),
  /** Consecutive failed fetches. A source failing five runs in a row is flagged. */
  failures: z.number().int().nonnegative().default(0),
  last_ok: isoDateTime.optional(),
  /** When a run last tried this source, win or lose. Orders the Firecrawl listing turns so a failing source cannot keep the first slot. */
  last_try: isoDateTime.optional(),
  /** Per-type options, such as GitHub `owner/repo` or a YouTube channel id. */
  options: z.record(z.string(), z.string()).default({}),
  /** True when a person fixed this source in the app; automatic cleanup leaves it alone. */
  pinned: z.boolean().optional(),
  /** Where the entry came from: the seed list, added by hand in the app, or found by discovery. */
  origin: z.enum(["seed", "manual", "auto"]).optional(),
  /** Custom topics this source feeds. Items from it are judged against those topics. */
  topic_ids: z.array(IdString).optional(),
  /** The discovery score (0 to 1) an automatically added source earned, and when. */
  quality: z.object({ score: z.number().min(0).max(1), scored_at: isoDateTime }).optional(),
});
export type Source = z.infer<typeof Source>;

export const SourcesFile = z.object({
  version: z.literal(1),
  sources: z.array(Source),
});
export type SourcesFile = z.infer<typeof SourcesFile>;

/**
 * Opt-in ways to fetch a firecrawl source, each with the site it reads. The key is stored as the
 * source's `options.via`; `category` is the provider listing the engine narrows to.
 */
export const FETCH_VIA = {
  "alexandria:anthropic-com": { host: "anthropic.com", category: "news" },
} as const;
export type FetchVia = keyof typeof FETCH_VIA;
export const FetchViaValue = z.enum(Object.keys(FETCH_VIA) as [FetchVia, ...FetchVia[]]);

/** Longest name the app can give a source. */
export const SOURCE_NAME_MAX = 80;

/**
 * What a person changed about one source from the app. Applies to seed and added sources alike,
 * though the app edits an added source in place and keeps overrides for seed sources.
 */
export const SourceOverride = z.object({
  enabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
  /** Hides a seed source. Removing an added source deletes it instead. */
  removed: z.boolean().optional(),
  /** Replaces the source's own name. */
  name: z.string().trim().min(1).max(SOURCE_NAME_MAX).optional(),
  /** Replaces the topics the source feeds; an empty list means none of its own. */
  topic_ids: z.array(IdString).optional(),
  /** Replaces the source's own format. */
  format: SourceFormat.optional(),
  /** Replaces the source's own lean; null clears it. */
  lean: z.number().int().min(-2).max(2).nullable().optional(),
  /** Replaces the source's own high_signal: a favorite in the app. */
  high_signal: z.boolean().optional(),
  /** Options laid over the source's own (`source.update` fetch_via sets `via` and `category`). */
  options: z.record(z.string(), z.string()).optional(),
});
export type SourceOverride = z.infer<typeof SourceOverride>;

/**
 * Shape of config/sources.user.json: edits made from the app, kept apart from config/sources.json
 * so regenerating that file from config/sources.md can never discard them.
 */
export const SourcesUserFile = z.object({
  version: z.literal(1),
  added: z.array(Source),
  overrides: z.record(z.string(), SourceOverride),
});
export type SourcesUserFile = z.infer<typeof SourcesUserFile>;
export const EMPTY_SOURCES_USER: SourcesUserFile = { version: 1, added: [], overrides: {} };
