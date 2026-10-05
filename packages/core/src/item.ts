import { z } from "zod";

export const SOURCE_TYPES = [
  "rss",
  "github",
  "hn",
  "youtube",
  "exa",
  "firecrawl",
  "crossref",
  "arxiv",
  "lobsters",
  "producthunt",
] as const;
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;

const isoDateTime = z.string().datetime({ offset: true });

/** One candidate piece of content, normalized from any source. */
export const Item = z.object({
  /** First 12 hex characters of sha1(canonical_url). */
  id: z.string().regex(/^[0-9a-f]{12}$/),
  url: z.string().url(),
  canonical_url: z.string().url(),
  title: z.string().min(1),
  source_id: z.string().min(1),
  source_type: SourceType,
  author: z.string().optional(),
  published_at: isoDateTime.optional(),
  fetched_at: isoDateTime,
  /** Short text from the feed or search result. Untrusted. */
  snippet: z.string().default(""),
  signals: z
    .object({
      hn_points: z.number().int().nonnegative().optional(),
      hn_comments: z.number().int().nonnegative().optional(),
      lobsters_score: z.number().int().optional(),
    })
    .default({}),
  /** Extracted full text. Lives in the run cache only; never committed. Untrusted. */
  content: z.string().optional(),
});
export type Item = z.infer<typeof Item>;
