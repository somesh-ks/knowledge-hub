import type { Site } from "../lib/site";
import { type BlobFetch, type NarrateBlobStore, readFresh, readPublicText } from "./blobStore";

/**
 * Tombstones: the ids of episodes the owner deleted, written to the content store the moment the
 * delete is accepted. The git commit and `content sync` follow minutes later; until the manifest
 * drops the episode, every page rendered on request skips these ids, so no device sees it. The
 * file lives outside content/ so a sync never removes it, and entries expire after a week (by then
 * the store has dropped the episode and the entry does nothing).
 */
export const TOMBSTONES_PATH = "tombstones/episodes.json";
const TOMBSTONE_TTL_MS = 7 * 86_400_000;
const WRITE = { contentType: "application/json", cacheSeconds: 60 } as const;

interface Tombstone {
  id: string;
  at: number;
}

function parse(text: string | null): Tombstone[] {
  try {
    const list: unknown = JSON.parse(text ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(
      (entry): entry is Tombstone => typeof entry?.id === "string" && typeof entry?.at === "number",
    );
  } catch {
    return [];
  }
}

/** The ids deleted and not yet gone from the store. A store with no file, or that fails, has none. */
export async function readTombstones(
  base: string,
  doFetch: BlobFetch,
  now: number,
): Promise<ReadonlySet<string>> {
  try {
    const text = await readPublicText(`${base}/${TOMBSTONES_PATH}?t=${now}`, doFetch);
    return new Set(parse(text).map((entry) => entry.id));
  } catch {
    return new Set();
  }
}

/** The site without the tombstoned episodes. */
export function withoutTombstoned(site: Site, ids: ReadonlySet<string>): Site {
  return ids.size === 0
    ? site
    : { ...site, episodes: site.episodes.filter((entry) => !ids.has(entry.id)) };
}

/** Records a delete the server accepted. */
export async function addTombstone(
  store: NarrateBlobStore,
  id: string,
  now: number,
): Promise<void> {
  const stored = await readFresh(store, TOMBSTONES_PATH);
  const kept = parse(stored?.text ?? null).filter(
    (entry) => entry.id !== id && now - entry.at < TOMBSTONE_TTL_MS,
  );
  await store.put(TOMBSTONES_PATH, JSON.stringify([...kept, { id, at: now }]), WRITE);
}
