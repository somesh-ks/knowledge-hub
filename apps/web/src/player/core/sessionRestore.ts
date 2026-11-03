import type { StorageLike } from "./resume";

/**
 * What the tab remembers of the player across a reload (a deploy, a pull to refresh, a tab the phone
 * dropped and brought back): the track on the bar, and whether the full player was open. It lives
 * in session storage, so a new tab or a fresh launch starts clean (owner, 2026-11-03: a deploy must
 * not cost the reader their place). The position and the queue are kept apart, in their own keys.
 */
export const SESSION_KEY = "singularity:player-session";

export interface PlayerSession {
  id: string;
  open: boolean;
}

export function parseSession(raw: string | null): PlayerSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; open?: unknown } | null;
    if (typeof parsed?.id !== "string" || parsed.id.length === 0) return null;
    return { id: parsed.id, open: parsed.open === true };
  } catch {
    return null;
  }
}

export function readSession(storage: StorageLike | null): PlayerSession | null {
  try {
    return parseSession(storage?.getItem(SESSION_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveSession(storage: StorageLike | null, session: PlayerSession): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Best effort: private modes and quotas throw.
  }
}

/**
 * Set while the open player is put back after a reload: that opening is silent (no cue, no buzz),
 * since nobody touched anything. The first commit of an opening takes the flag.
 */
const quiet = { open: false };

export function openQuietly(reopen: () => void): void {
  quiet.open = true;
  reopen();
  // An opening that never commits must not silence a later, real one.
  setTimeout(() => {
    quiet.open = false;
  }, 5000);
}

/** True once for the opening that put the player back. */
export function takeQuietOpen(): boolean {
  const was = quiet.open;
  quiet.open = false;
  return was;
}

/**
 * True when this page load brings the tab back (a reload, or a return through history), not when the
 * reader opens an address: a typed or followed link to the app starts clean.
 */
export function isReturn(
  entries: readonly { type?: string }[] = typeof performance === "undefined"
    ? []
    : (performance.getEntriesByType("navigation") as PerformanceNavigationTiming[]),
): boolean {
  const type = entries[0]?.type;
  return type === "reload" || type === "back_forward";
}
