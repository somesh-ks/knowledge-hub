/**
 * Settings edits that could not be sent because the site could not be reached (CFG-04). The change
 * stays on this device, in the order it was made, and goes out when the connection is back: a reload
 * or a closed tab in between loses nothing. Each entry is one request's edits, which the sender
 * never splits (a new topic and the sources chosen with it go together).
 *
 * Kept apart from the saved edits (lib/savedOverlay.ts): those are copies of what the server took and
 * expire in minutes; an outbox entry is the only copy of an edit, so it expires only after two weeks,
 * long past any phone that was in a drawer.
 */
import type { ConfigOp } from "../types/contracts";
import { OUTBOX_KEY } from "./savedKey";

/** An edit older than this is dropped: it was made against a settings page that has long changed. */
export const OUTBOX_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface OutboxEntry {
  /** When it was made, in epoch milliseconds. */
  at: number;
  ops: ConfigOp[];
}

/** The entries in storage, oldest first. Malformed ones, and ones past the limit, are left out. */
export function parseOutbox(raw: string | null, now: number): OutboxEntry[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept: OutboxEntry[] = [];
    for (const entry of parsed) {
      const { at, ops } = (entry ?? {}) as { at?: unknown; ops?: unknown };
      if (typeof at !== "number" || !Array.isArray(ops) || ops.length === 0) continue;
      if (at > now || now - at >= OUTBOX_TTL_MS) continue;
      kept.push({ at, ops: ops as ConfigOp[] });
    }
    return kept;
  } catch {
    return [];
  }
}

/** The entries this device holds. Storage that cannot be read holds none. */
export function readOutbox(now = Date.now()): OutboxEntry[] {
  try {
    return parseOutbox(localStorage.getItem(OUTBOX_KEY), now);
  } catch {
    return [];
  }
}

/** Every edit in the outbox, in the order it was made, for a page to show them already applied. */
export function outboxOps(now = Date.now()): ConfigOp[] {
  return readOutbox(now).flatMap((entry) => entry.ops);
}

/** Replaces what is kept. False when storage is refused. */
export function writeOutbox(entries: readonly OutboxEntry[]): boolean {
  try {
    if (entries.length > 0) localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
    else localStorage.removeItem(OUTBOX_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps one request's edits for later, after the ones already waiting. False when storage is refused:
 * the edit is then not kept, and the caller treats it as not saved.
 */
export function appendOutbox(ops: readonly ConfigOp[], now = Date.now()): boolean {
  if (ops.length === 0) return true;
  return writeOutbox([...readOutbox(now), { at: now, ops: [...ops] }]);
}

/** Takes the oldest `count` entries out, once they were sent or refused for good. */
export function dropOldest(count = 1, now = Date.now()): void {
  writeOutbox(readOutbox(now).slice(count));
}
