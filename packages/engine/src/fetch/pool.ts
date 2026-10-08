import { DigestId, DigestKind, Item } from "@dispatch/core";
import { z } from "zod";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { stableStringify } from "../state/stableJson.js";

const isoDateTime = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();

/** The hand-off from `dispatch fetch` to curation: ranked candidates plus how they were found. */
export const PoolFile = z.object({
  version: z.literal(1),
  /** Digest id the pool was gathered for, which is also its run directory name. */
  id: DigestId,
  kind: DigestKind,
  generated_at: isoDateTime,
  window: z.object({ from: isoDateTime, to: isoDateTime }),
  sources: z.array(
    z.object({
      source_id: z.string(),
      ok: z.boolean(),
      count,
      ms: count,
      error: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
  report: z.object({
    fetched: count,
    dedupe: z.object({
      input: count,
      already_seen: count,
      same_url: count,
      newsletter_collapsed: count,
      near_duplicate: count,
      story_clustered: count,
      output: count,
    }),
    prefilter: z.object({
      input: count,
      kept: count,
      dropped: z.object({ disliked: count, not_relevant: count, source_cap: count, cap: count }),
      /** The consumer tech sub-pool, which has its own cap beside the main one. */
      tech: z.object({ input: count, kept: count, source_cap: count, cap: count }),
      /** The Trending sub-pool: stories at least two outlets covered. */
      trending: z
        .object({
          input: count,
          single_outlet: count,
          kept: count,
          source_cap: count,
          cap: count,
        })
        .default({ input: 0, single_outlet: 0, kept: 0, source_cap: 0, cap: 0 }),
    }),
  }),
  /** Best candidate first. Item text is untrusted. */
  items: z.array(Item),
});
export type PoolFile = z.infer<typeof PoolFile>;

/** Where a run keeps its working files. Gitignored. */
export function runDirRelPath(id: string): string {
  return `.cache/run/${id}`;
}

export function poolRelPath(id: string): string {
  return `${runDirRelPath(id)}/pool.json`;
}

/** Validate and write a pool atomically. Returns the validated pool. */
export async function writePool(path: string, pool: PoolFile): Promise<PoolFile> {
  const checked = PoolFile.parse(pool);
  await writeFileAtomic(path, stableStringify(checked));
  return checked;
}
