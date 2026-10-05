import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DigestId, type DigestKind } from "@dispatch/core";
import type { DigestIdAllocator } from "./buildDigest.js";

const MAX_SUFFIX = 99;

/**
 * The next free digest id, by the same rule `dispatch fetch` uses. A weekly pass takes
 * `<date>-weekly`; every other kind takes `<date>`. When that id is taken, both continue with
 * `<date>-2`, `-3` and so on (core ids have no `-weekly-2`). Never reuses an id.
 */
export function nextDigestId(date: string, kind: DigestKind, taken: ReadonlySet<string>): string {
  const candidates: string[] = [kind === "weekly" ? `${date}-weekly` : date];
  for (let n = 2; n <= MAX_SUFFIX; n++) candidates.push(`${date}-${n}`);
  const free = candidates.find((id) => !taken.has(id));
  if (free === undefined) throw new Error(`No free digest id left for ${date}.`);
  return DigestId.parse(free);
}

/** Ids of digest files already committed for the month of `date`. */
export async function listTakenIds(root: string, date: string): Promise<Set<string>> {
  const [year, month] = date.split("-");
  const dir = join(root, "Digests", year ?? "", month ?? "");
  try {
    const names = await readdir(dir);
    return new Set(names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -".md".length)));
  } catch {
    return new Set();
  }
}

/**
 * An allocator over a set of taken ids. It records each id it hands out. `preferred` is the id
 * `dispatch fetch` reserved for the run: it is used when still free, otherwise the next free
 * id on the same date. Without it the id comes from the date and kind the builder passes in.
 */
export function createIdAllocator(taken: Set<string>, preferred?: string): DigestIdAllocator {
  const reserved =
    preferred !== undefined && DigestId.safeParse(preferred).success ? preferred : undefined;
  return ({ date, kind }) => {
    const id =
      reserved !== undefined && !taken.has(reserved)
        ? reserved
        : nextDigestId(reserved?.slice(0, 10) ?? date, kind, taken);
    taken.add(id);
    return id;
  };
}
