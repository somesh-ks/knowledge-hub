import { isFiniteNumber } from "./mathUtils";

/** The slice of Storage the player uses, so tests can inject a map and private mode can inject nothing. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESUME_KEY_PREFIX = "dispatch:resume:";
/** Seconds from the end inside which a saved position counts as "finished". */
const FINISHED_TAIL_SECONDS = 3;
/** Positions under this are not worth restoring: the listener barely started. */
const MIN_RESTORE_SECONDS = 2;

/**
 * Set once an item has been heard to the end, and cleared when a new position is saved. The Library
 * reads it (scripts/libraryPage.ts) to say "Played" without loading any player code.
 */
export const PLAYED_KEY_PREFIX = "dispatch:played:";

export function resumeKey(digestId: string): string {
  return `${RESUME_KEY_PREFIX}${digestId}`;
}

export function playedKey(digestId: string): string {
  return `${PLAYED_KEY_PREFIX}${digestId}`;
}

/** Heard to the end: the position is forgotten and the item is marked played. */
function markPlayed(storage: StorageLike, digestId: string): void {
  storage.removeItem(resumeKey(digestId));
  storage.setItem(playedKey(digestId), "1");
}

/** Storage is best effort: every access is guarded because private modes and quotas throw. */
export function readResumePosition(
  storage: StorageLike | null,
  digestId: string,
  durationSeconds: number,
): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(resumeKey(digestId));
    if (raw === null) return 0;
    const seconds = Number(raw);
    if (!isFiniteNumber(seconds) || seconds < MIN_RESTORE_SECONDS) return 0;
    // A saved position at the very end would resume into silence. Start over instead.
    if (durationSeconds > 0 && seconds >= durationSeconds - FINISHED_TAIL_SECONDS) return 0;
    return durationSeconds > 0 ? Math.min(seconds, durationSeconds) : seconds;
  } catch {
    return 0;
  }
}

export function saveResumePosition(
  storage: StorageLike | null,
  digestId: string,
  seconds: number,
  durationSeconds: number,
): void {
  if (!storage) return;
  try {
    const finished = durationSeconds > 0 && seconds >= durationSeconds - FINISHED_TAIL_SECONDS;
    if (finished) markPlayed(storage, digestId);
    else if (seconds < MIN_RESTORE_SECONDS) storage.removeItem(resumeKey(digestId));
    else {
      // Listening again: a position of its own replaces "Played".
      storage.setItem(resumeKey(digestId), String(Math.floor(seconds)));
      storage.removeItem(playedKey(digestId));
    }
  } catch {
    // Best effort.
  }
}

/** The item ended: nothing to resume, and it counts as played. */
export function clearResumePosition(storage: StorageLike | null, digestId: string): void {
  if (!storage) return;
  try {
    markPlayed(storage, digestId);
  } catch {
    // Best effort.
  }
}

/** localStorage, or null when the browser refuses access (Safari private mode, blocked site data). */
export function safeLocalStorage(): StorageLike | null {
  try {
    // On the server (Astro renders islands at build time) there is no storage, and recent Node
    // versions expose a throwing stand-in under the same name.
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
