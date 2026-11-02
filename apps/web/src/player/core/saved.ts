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

/** When the item was saved (ms since the epoch), so the Saved page lists the newest first; null if not saved. */
export function savedAt(storage: StorageLike | null, digestId: string): number | null {
  try {
    const value = storage?.getItem(savedKey(digestId));
    if (value == null) return null;
    const at = Number(value);
    // An older mark that carries no time sorts last.
    return Number.isFinite(at) ? at : 0;
  } catch {
    return null;
  }
}

/** This device's storage, or null where reading it throws (blocked site data). */
export function deviceStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Saves (`on`) or forgets an item. Returns whether storage took the write; false means nothing changed. */
export function setSaved(
  storage: StorageLike | null,
  digestId: string,
  on: boolean,
  now: number = Date.now(),
): boolean {
  try {
    if (!storage) return false;
    if (on) storage.setItem(savedKey(digestId), String(now));
    else storage.removeItem(savedKey(digestId));
  } catch {
    return false;
  }
  announce(digestId);
  return true;
}
