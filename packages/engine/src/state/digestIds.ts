import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DigestId } from "@singularity/core";

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Ids of every digest on disk (Digests/YYYY/MM/<id>.md). Used to allocate the next free id, so
 * an existing digest is never overwritten.
 */
export async function listDigestIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  const base = join(root, "Digests");
  for (const year of await listDir(base)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const month of await listDir(join(base, year))) {
      if (!/^\d{2}$/.test(month)) continue;
      for (const file of await listDir(join(base, year, month))) {
        if (!file.endsWith(".md")) continue;
        const id = file.slice(0, -3);
        if (DigestId.safeParse(id).success) ids.push(id);
      }
    }
  }
  return ids.sort();
}
