import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Item, type SourceType } from "@singularity/core";
import { z } from "zod";
import { loadPool } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";

/**
 * The stories a run gathered, kept beside its digest in the content store (D376) so a rewrite of
 * that digest reuses them and fetches only what is quick to read again. Before this, a rewrite
 * turned listing memory off and scraped every listing through Firecrawl, 6.5 s apart: Fetch took
 * 2 min 12 s of the owner's 5.5-minute rewrite on 2026-11-06.
 */
export const POOLS_DIR = "Pools";

/** A pool older than this is not carried: a rewrite of an older digest fetches everything. */
export const CARRY_HOURS = 48;

/**
 * The sources a carried rewrite does not read again: paced Firecrawl listings, YouTube (relayed
 * through Firecrawl since the runners are refused) and Exa's paid queries. Their stories come from
 * the pool; the feeds and APIs that answer at once are read as usual, so newer stories still join.
 */
export const CARRIED_TYPES: ReadonlySet<SourceType> = new Set(["firecrawl", "youtube", "exa"]);
export const CARRIED_NOTE = "carried from the run it replaces";

const KeptPool = z.object({
  version: z.literal(1),
  id: z.string(),
  saved_at: z.string().datetime({ offset: true }),
  items: z.array(Item),
});
type KeptPool = z.infer<typeof KeptPool>;

export function keptPoolPath(root: string, digestId: string): string {
  return join(root, POOLS_DIR, `${digestId}.json`);
}

/**
 * Keeps a published pass's pool (its main pool only: general stories stay apart, D66) under the
 * digest's id, and drops pools past CARRY_HOURS, so the store holds a day or two of them.
 */
export async function keepPools(
  root: string,
  kept: readonly { digestId: string; poolPath: string }[],
  now: Date,
): Promise<void> {
  for (const { digestId, poolPath } of kept) {
    const pool = await loadPool(poolPath);
    const file: KeptPool = {
      version: 1,
      id: digestId,
      saved_at: now.toISOString(),
      items: pool.items,
    };
    await writeJson(keptPoolPath(root, digestId), file);
  }
  const names = await readdir(join(root, POOLS_DIR)).catch(() => [] as string[]);
  for (const name of names) {
    const path = join(root, POOLS_DIR, name);
    const saved = await readKept(path);
    if (saved === null || isStale(saved, now)) await rm(path, { force: true });
  }
}

async function readKept(path: string): Promise<KeptPool | null> {
  try {
    const parsed = KeptPool.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isStale(pool: KeptPool, now: Date): boolean {
  return now.getTime() - Date.parse(pool.saved_at) > CARRY_HOURS * 3_600_000;
}

/**
 * The stories the run that made `digestId` gathered, or null when there is no pool fresh enough to
 * carry (none kept, unreadable, or older than CARRY_HOURS): the rewrite then fetches everything.
 * shortcut: a rewrite of a rewrite carries the second run's pool, whose time is its own, so three
 * rewrites (the cap, D212) can stretch a pool past CARRY_HOURS; upgrade if that shows stale stories.
 */
export async function readCarried(
  root: string,
  digestId: string,
  now: Date,
): Promise<Item[] | null> {
  const pool = await readKept(keptPoolPath(root, digestId));
  return pool === null || isStale(pool, now) ? null : pool.items;
}
