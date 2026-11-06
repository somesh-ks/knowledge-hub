import { isFiniteNumber } from "./mathUtils";

/** The slice of Storage the player uses, so tests can inject a map and private mode can inject nothing. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESUME_KEY_PREFIX = "singularity:resume:";
/** Seconds from the end inside which a saved position counts as "finished". */
const FINISHED_TAIL_SECONDS = 3;
/** Positions under this are not worth restoring: the listener barely started. */
const MIN_RESTORE_SECONDS = 2;

/**
 * Set once an item has been heard to the end, and cleared when a new position is saved. Every card
 * reads it (cardProgress.ts) to say "Played".
 */
export const PLAYED_KEY_PREFIX = "singularity:played:";

/** Tells the page that what the device remembers of a recording changed (the cards read it). */
function announce(digestId: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(new CustomEvent("singularity:resume", { detail: digestId }));
}

export function resumeKey(digestId: string): string {
  return `${RESUME_KEY_PREFIX}${digestId}`;
}

export function playedKey(digestId: string): string {
  return `${PLAYED_KEY_PREFIX}${digestId}`;
}

/**
 * The recording a device's position (or "Played") belongs to: its audio address. A rewrite keeps the
 * digest's id and gets a new recording, so a position kept by id alone starts the new one where the
 * old one was left (2026-11-06, the owner's phone: a rewrite began at 4 minutes). Memory written
 * before this key existed has none and is taken as it stands.
 */
export const RECORDING_KEY_PREFIX = "singularity:resume-of:";

export function recordingKey(digestId: string): string {
  return `${RECORDING_KEY_PREFIX}${digestId}`;
}

/**
 * The address that names a digest's recording: the file the browser tries first. New data that names
 * the same file (a refresh of the page's facts) is the same recording; a rewrite names new files.
 */
export function recordingOf(
  audio: { url: string; m4a_url?: string | undefined } | null | undefined,
): string | undefined {
  return audio ? (audio.m4a_url ?? audio.url) : undefined;
}

/** Heard to the end: the position is forgotten and the item is marked played. */
function markPlayed(storage: StorageLike, digestId: string, audioUrl?: string): void {
  storage.removeItem(resumeKey(digestId));
  storage.setItem(playedKey(digestId), "1");
  rememberRecording(storage, digestId, audioUrl);
  announce(digestId);
}

function rememberRecording(storage: StorageLike, digestId: string, audioUrl?: string): void {
  if (audioUrl) storage.setItem(recordingKey(digestId), audioUrl);
}

/**
 * Drops what the device remembers of a recording that has since been replaced: its position, its
 * "Played" and the note of which recording it was. The stories heard stay (item ids outlive a rewrite).
 */
function forgetReplaced(storage: StorageLike | null, digestId: string, audioUrl?: string): void {
  if (!storage || !audioUrl) return;
  try {
    const saved = storage.getItem(recordingKey(digestId));
    if (saved === null || saved === audioUrl) return;
    storage.removeItem(resumeKey(digestId));
    storage.removeItem(playedKey(digestId));
    storage.removeItem(recordingKey(digestId));
    announce(digestId);
  } catch {
    // Best effort.
  }
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
  audioUrl?: string,
): number {
  forgetReplaced(storage, digestId, audioUrl);
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
  audioUrl?: string,
): void {
  if (!storage) return;
  try {
    // A duration inside the tail is no recording's: it is the unlock primer's silence (0.05 s), whose
    // position 0 would otherwise read as the end.
    const finished =
      durationSeconds > FINISHED_TAIL_SECONDS && seconds >= durationSeconds - FINISHED_TAIL_SECONDS;
    if (finished) markPlayed(storage, digestId, audioUrl);
    else if (seconds < MIN_RESTORE_SECONDS) storage.removeItem(resumeKey(digestId));
    else {
      // Listening again: a position of its own replaces "Played".
      storage.setItem(resumeKey(digestId), String(Math.floor(seconds)));
      storage.removeItem(playedKey(digestId));
      rememberRecording(storage, digestId, audioUrl);
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
export const HEARD_KEY_PREFIX = "singularity:heard:";

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
  audioUrl?: string,
): Remembered {
  const seconds = readResumePosition(storage, digestId, durationSeconds, audioUrl);
  const played = read(storage, playedKey(digestId)) !== null;
  const heard = seconds > 0 || played ? read(storage, HEARD_KEY_PREFIX + digestId) : null;
  return { seconds, played, heard: heard ? heard.split(" ") : [] };
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
export function clearResumePosition(
  storage: StorageLike | null,
  digestId: string,
  audioUrl?: string,
): void {
  if (!storage) return;
  try {
    markPlayed(storage, digestId, audioUrl);
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
