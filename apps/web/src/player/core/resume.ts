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
 * Set once an item has been heard to the end, and cleared when a new position is saved. Every card
 * reads it (cardProgress.ts) to say "Played".
 */
export const PLAYED_KEY_PREFIX = "dispatch:played:";

/** Tells the page that what the device remembers of a recording changed (the cards read it). */
function announce(digestId: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("dispatch:resume", { detail: digestId }));
}

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
  announce(digestId);
}

/** Storage is best effort: every access is guarded because private modes and quotas throw. */
function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readResumePosition(
  storage: StorageLike | null,
  digestId: string,
  durationSeconds: number,
): number {
  const raw = read(storage, resumeKey(digestId));
  if (raw === null) return 0;
  const seconds = Number(raw);
  if (!isFiniteNumber(seconds) || seconds < MIN_RESTORE_SECONDS) return 0;
  // A saved position at the very end would resume into silence. Start over instead.
  if (durationSeconds > 0 && seconds >= durationSeconds - FINISHED_TAIL_SECONDS) return 0;
  return durationSeconds > 0 ? Math.min(seconds, durationSeconds) : seconds;
}

export function saveResumePosition(
  storage: StorageLike | null,
  digestId: string,
  seconds: number,
  durationSeconds: number,
): void {
  if (!storage) return;
  try {
    // A duration inside the tail is no recording's: it is the unlock primer's silence (0.05 s), whose
    // position 0 would otherwise read as the end.
    const finished =
      durationSeconds > FINISHED_TAIL_SECONDS && seconds >= durationSeconds - FINISHED_TAIL_SECONDS;
    if (finished) markPlayed(storage, digestId);
    else if (seconds < MIN_RESTORE_SECONDS) storage.removeItem(resumeKey(digestId));
    else {
      // Listening again: a position of its own replaces "Played".
      storage.setItem(resumeKey(digestId), String(Math.floor(seconds)));
      storage.removeItem(playedKey(digestId));
      announce(digestId);
    }
  } catch {
    // Best effort.
  }
}

/**
 * The stories heard, by item id, beside the position: an item id outlives a rewrite of the
 * recording, where an index would mark another story. Space-separated (ids hold no spaces).
 */
export const HEARD_KEY_PREFIX = "dispatch:heard:";

/**
 * What the device remembers of a recording: where it was left, whether it was heard to the end,
 * and which stories were heard.
 */
export interface Remembered {
  seconds: number;
  played: boolean;
  heard: string[];
}

/**
 * The one reader of a recording's memory, for its page's chips, the player and every card. Without
 * a duration (a card, a briefing narrated on Play) the position is taken as stored. The stories
 * heard count only beside a position or the end: without either, the recording restarted.
 */
export function readRemembered(
  storage: StorageLike | null,
  digestId: string,
  durationSeconds = 0,
): Remembered {
  const seconds = readResumePosition(storage, digestId, durationSeconds);
  const played = read(storage, playedKey(digestId)) !== null;
  const heard = seconds > 0 || played ? read(storage, HEARD_KEY_PREFIX + digestId) : null;
  return { seconds, played, heard: heard?.split(" ").filter(Boolean) ?? [] };
}

export function saveHeard(storage: StorageLike | null, digestId: string, ids: string[]): void {
  try {
    if (ids.length > 0) storage?.setItem(HEARD_KEY_PREFIX + digestId, ids.join(" "));
    else storage?.removeItem(HEARD_KEY_PREFIX + digestId);
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
