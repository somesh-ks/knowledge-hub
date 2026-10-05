import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DigestId, type DigestKind } from "@dispatch/core";
import type { DigestIdAllocator } from "./buildDigest.js";

const MAX_SUFFIX = 99;

/**
 * The next free digest id. A weekly pass takes `<date>-weekly` first; every other kind, and a
 * weekly whose id is taken, takes `<date>`, then `<date>-2`, `-3` and so on. Never reuses an id.
 */
export function nextDigestId(date: string, kind: DigestKind, taken: ReadonlySet<string>): string {
  const candidates: string[] = [];
  if (kind === "weekly") candidates.push(`${date}-weekly`);
  candidates.push(date);
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

/** An allocator over a set of taken ids. It records each id it hands out. */
export function createIdAllocator(taken: Set<string>): DigestIdAllocator {
  return ({ date, kind }) => {
    const id = nextDigestId(date, kind, taken);
    taken.add(id);
    return id;
  };
}
