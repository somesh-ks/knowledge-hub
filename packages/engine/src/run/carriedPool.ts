import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Item, type SourceType } from "@singularity/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";

/**
 * The stories a run took from its slow sources, kept beside its digest in the content store (D376)
 * so a rewrite of that digest reuses them and reads only the sources that answer at once. Before
 * this, a rewrite turned listing memory off and scraped every listing through Firecrawl, 6.5 s
 * apart: Fetch took 2 min 12 s of the owner's 5.5-minute rewrite on 2026-11-06.
 */
export const POOLS_DIR = "Pools";

/** A pool older than this is not carried: a rewrite of an older digest fetches everything. */
export const CARRY_HOURS = 48;

/**
 * The sources a carried rewrite does not read again: paced Firecrawl listings, YouTube (relayed
 * through Firecrawl since the runners are refused) and Exa's paid queries. Their stories come from
 * the kept pool; feeds and APIs are read as usual, so newer stories still join.
 */
export const CARRIED_TYPES: ReadonlySet<SourceType> = new Set(["firecrawl", "youtube", "exa"]);
export const CARRIED_NOTE = "carried from the run it replaces";

const KeptPool = z.object({
  version: z.literal(1),
  saved_at: z.string().datetime({ offset: true }),
  items: z.array(Item),
});
type KeptPool = z.infer<typeof KeptPool>;

export function keptPoolPath(root: string, digestId: string): string {
  return join(root, POOLS_DIR, `${digestId}.json`);
}

/**
 * Every story the slow sources gave the pass after dedupe, the prefilter's leftovers included: a
 * rewrite asked to be longer reads further down the list than the run did. Written beside the
 * pass's pool, for the commit stage to keep.
 */
export function slowStories(pool: readonly Item[], leftovers: readonly Item[]): Item[] {
  return [...pool, ...leftovers].filter((item) => CARRIED_TYPES.has(item.source_type));
}

/**
 * Keeps each published pass's slow stories under its digest's id, and drops pools past
 * CARRY_HOURS, so the store holds a day or two of them.
 */
export async function keepPools(
  root: string,
  kept: readonly { digestId: string; storiesPath: string }[],
  now: Date,
): Promise<void> {
  for (const { digestId, storiesPath } of kept) {
    const items = z.array(Item).parse(await readJsonIfExists(storiesPath, "slow stories"));
    const file: KeptPool = { version: 1, saved_at: now.toISOString(), items };
    await writeJson(keptPoolPath(root, digestId), file);
  }
  const names = await readdir(join(root, POOLS_DIR)).catch(() => [] as string[]);
  for (const name of names) {
    const path = join(root, POOLS_DIR, name);
    if (isStale(await savedAt(path), now)) await rm(path, { force: true });
  }
}

/** When a kept pool was saved, read without its stories; null when it cannot be read. */
async function savedAt(path: string): Promise<string | null> {
  try {
    const saved = (JSON.parse(await readFile(path, "utf8")) as { saved_at?: unknown }).saved_at;
    return typeof saved === "string" ? saved : null;
  } catch {
    return null;
  }
}

function isStale(saved: string | null, now: Date): boolean {
  const at = saved === null ? Number.NaN : Date.parse(saved);
  return !(now.getTime() - at <= CARRY_HOURS * 3_600_000);
}

/** Drops a digest's kept pool, so a later digest given the same id never carries it. */
export async function forgetPool(root: string, digestId: string): Promise<void> {
  await rm(keptPoolPath(root, digestId), { force: true });
}

/**
 * The slow stories of the run that made `digestId`, or null when no pool is fresh enough to carry
 * (none kept, unreadable, or older than CARRY_HOURS): the rewrite then fetches everything.
 * shortcut: a rewrite of a rewrite keeps the pool again under its own time, so three rewrites (the
 * cap, D212) can stretch stories past CARRY_HOURS; upgrade if that shows stale stories.
 */
export async function readCarried(
  root: string,
  digestId: string,
  now: Date,
): Promise<Item[] | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(keptPoolPath(root, digestId), "utf8"));
    const pool = KeptPool.safeParse(raw);
    return pool.success && !isStale(pool.data.saved_at, now) ? pool.data.items : null;
  } catch {
    return null;
  }
}
