import type { ExperimentAction, FlagRow } from "./experimentsApi.js";

/**
 * A switch the owner pressed whose write the store has not confirmed. The page moves the switch at
 * once and remembers the change across a reload, so a reload that overtakes the write (the store
 * takes a second or two) shows what was asked, not the old state. It lets go when the store has it
 * or after PENDING_SECONDS, so a write that never landed does not stay on screen.
 */
export const PENDING_SECONDS = 30;

export interface Pending {
  flag: FlagRow;
  /** Epoch milliseconds when it was asked. */
  at: number;
}

export type PendingMap = Record<string, Pending>;

/** The switch a change leaves, from the switch as it stands. */
export function intended(current: FlagRow, action: ExperimentAction, now: number): FlagRow {
  switch (action) {
    case "on":
      return { ...current, enabled: true };
    case "off":
      return { ...current, enabled: false };
    case "promote":
      return { ...current, enabled: true, promoted_at: now };
    case "unpromote":
      return { ...current, promoted_at: null };
  }
}

const fresh = (pending: Pending, now: number): boolean => now - pending.at < PENDING_SECONDS * 1000;

const matches = (stored: FlagRow | undefined, asked: FlagRow): boolean =>
  stored !== undefined &&
  stored.enabled === asked.enabled &&
  (stored.promoted_at === null) === (asked.promoted_at === null);

/** The writes the store has not caught up with, and that are not too old to wait for. */
export function unsettled(stored: FlagRow[], pending: PendingMap, now: number): PendingMap {
  const kept: PendingMap = {};
  for (const [id, entry] of Object.entries(pending)) {
    const have = stored.find((flag) => flag.id === id);
    if (fresh(entry, now) && !matches(have, entry.flag)) kept[id] = entry;
  }
  return kept;
}
