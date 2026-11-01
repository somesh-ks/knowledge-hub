import type { StorageLike } from "./resume";

/**
 * Set once the listener has saved a podcast from its player's menu, one key per item as the played
 * mark is, so a page reads one key per row and needs no list to keep in step. The Saved page in
 * Settings (scripts/savedPage.ts) shows the rows that have it.
 */
export const SAVED_KEY_PREFIX = "singularity:saved:";

export function savedKey(digestId: string): string {
  return `${SAVED_KEY_PREFIX}${digestId}`;
}

/** Tells the page that a save changed (the Saved page and the player's menu read it). */
function announce(digestId: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("singularity:saved", { detail: digestId }));
}

/** Storage is best effort: private modes and quotas throw, and then nothing is saved. */
export function isSaved(storage: StorageLike | null, digestId: string): boolean {
  try {
    return storage?.getItem(savedKey(digestId)) != null;
  } catch {
    return false;
  }
}

/** Saves or forgets an item. Returns whether it is saved now, which is false when storage refused. */
export function setSaved(storage: StorageLike | null, digestId: string, on: boolean): boolean {
  try {
    if (!storage) return false;
    if (on) storage.setItem(savedKey(digestId), "1");
    else storage.removeItem(savedKey(digestId));
  } catch {
    return false;
  }
  announce(digestId);
  return on;
}
