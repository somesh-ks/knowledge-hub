import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_FILES } from "./paths.js";

export const CATALOG_CADENCES = ["daily", "several a week", "weekly", "monthly"] as const;
export const CatalogCadence = z.enum(CATALOG_CADENCES);
export type CatalogCadence = z.infer<typeof CatalogCadence>;

/** At most this many words in a tag, and this many tags per entry: tags are matched, not read. */
const TAG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * One feed offered to the owner when they add a topic. An entry is an offer, not a source:
 * nothing in it is fetched until the owner adds it. Every entry is a feed (RSS or Atom read
 * directly), so adding one never needs Firecrawl.
 */
export const CatalogSource = z.object({
  /** Lowercase letters, digits and hyphens. Unique within the catalogue. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Human-facing page. */
  url: z.string().url(),
  /** The feed itself. Required: the catalogue holds feeds only. */
  feed_url: z.string().url(),
  /** One line saying what the feed covers. */
  about: z.string().min(1).max(120),
  cadence: CatalogCadence,
  /** Lowercase words a topic name or description is matched against. */
  tags: z.array(z.string().regex(TAG)).min(1).max(12),
});
export type CatalogSource = z.infer<typeof CatalogSource>;

/** Shape of config/source-catalog.json. Written by the engine side, read by the app at build time. */
export const SourceCatalog = z
  .object({
    version: z.literal(1),
    sources: z.array(CatalogSource),
  })
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    for (const [index, source] of catalog.sources.entries()) {
      if (ids.has(source.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "id"],
          message: `duplicate catalogue id ${source.id}`,
        });
      }
      ids.add(source.id);
    }
  });
export type SourceCatalog = z.infer<typeof SourceCatalog>;

export const EMPTY_SOURCE_CATALOG: SourceCatalog = { version: 1, sources: [] };

/** Parse catalogue JSON. Throws a ZodError naming the entry and field that is wrong. */
export function parseSourceCatalog(json: unknown): SourceCatalog {
  return SourceCatalog.parse(json);
}

/** config/source-catalog.json, or an empty catalogue when the file does not exist. */
export async function loadSourceCatalog(root: string): Promise<SourceCatalog> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.sourceCatalog), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_SOURCE_CATALOG;
    throw error;
  }
  return parseSourceCatalog(JSON.parse(text) as unknown);
}
