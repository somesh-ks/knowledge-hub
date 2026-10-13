import { loadPool, type ParsedPool, readJsonIfExists } from "../curate/inputs.js";
import { GeneralPoolFile } from "./generalNews.js";

/**
 * A pass's pool with its general stories added: the later stages rebuild the digest's items from
 * it, and the general stories (kept beside the pool, general.json) can be published since the
 * schedule lets a podcast carry them. A story already in the pool keeps the pool's copy.
 */
export async function loadPassPool(poolPath: string, generalPath: string): Promise<ParsedPool> {
  const pool = await loadPool(poolPath);
  const general = GeneralPoolFile.safeParse(await readJsonIfExists(generalPath, "general.json"));
  if (!general.success) return pool;
  const known = new Set(pool.items.map((item) => item.id));
  return { ...pool, items: [...pool.items, ...general.data.items.filter((i) => !known.has(i.id))] };
}
