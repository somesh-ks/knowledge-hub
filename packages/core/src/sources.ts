import { z } from "zod";
import { Category } from "./categories.js";
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
});
export type Source = z.infer<typeof Source>;

export const SourcesFile = z.object({
  version: z.literal(1),
  sources: z.array(Source),
});
export type SourcesFile = z.infer<typeof SourcesFile>;
