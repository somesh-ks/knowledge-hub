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

export function resumeKey(digestId: string): string {
  return `${RESUME_KEY_PREFIX}${digestId}`;
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
    if (seconds < MIN_RESTORE_SECONDS || finished) storage.removeItem(resumeKey(digestId));
    else storage.setItem(resumeKey(digestId), String(Math.floor(seconds)));
  } catch {
    // Best effort.
  }
}

export function clearResumePosition(storage: StorageLike | null, digestId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(resumeKey(digestId));
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
