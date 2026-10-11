import { z } from "zod";
import { Category, IdString } from "./categories.js";
import { SourceType } from "./item.js";

const isoDateTime = z.string().datetime({ offset: true });

/** One entry of config/sources.json, generated from config/Sources.md plus feed discovery. */
export const Source = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  type: SourceType,
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
