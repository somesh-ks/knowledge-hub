import { z } from "zod";
import { Category, IdString } from "./categories.js";

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
  "reddit",
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
      /** Reddit post score and comment count, when a Reddit source fetched the story (D240). */
      reddit_score: z.number().int().optional(),
      reddit_comments: z.number().int().nonnegative().optional(),
      /**
       * How many different sources covered the same story, when story clustering merged their
       * items into this one. Two or more; absent for a story only one source carried.
       */
      coverage: z.number().int().min(2).optional(),
    })
    .default({}),
  /**
   * The category a discovery query was written to find, copied from config/queries.json. A hint
   * for triage only: the source's own hint wins over it, and the judge decides the category.
   */
  category_hint: Category.optional(),
  /**
   * Custom topics the item's source or discovery query was tagged with. Items with a tag are
   * judged for those topics even when no keyword matches.
   */
  topic_ids: z.array(IdString).optional(),
  /** Extracted full text. Lives in the run cache only; never committed. Untrusted. */
  content: z.string().optional(),
});
export type Item = z.infer<typeof Item>;
