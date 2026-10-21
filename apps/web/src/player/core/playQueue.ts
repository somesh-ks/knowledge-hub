import type { StorageLike } from "./resume";

/**
 * The play queue: what the listener chose to hear next, in order, as the ids the Library and the
 * pages use ("2026-10-07" for a briefing, "ep-20261007-1930" for an episode). It is kept in
 * localStorage so it survives a reload. When the playing item ends, the first queued one starts:
 * the listener asked for it, unlike the previous briefing, which Up next only offers.
 *
 * The Library's card menu talks to it through two document events:
 *   dispatch:queue-add      detail { id }    append, unless queued already or playing now
 *   dispatch:queue-changed  detail { ids }   sent after every change, from here
 */
export const QUEUE_KEY = "dispatch:queue";
export const QUEUE_ADD_EVENT = "dispatch:queue-add";
export const QUEUE_CHANGED_EVENT = "dispatch:queue-changed";

/** A briefing or episode id: letters, digits and dashes, as the pages' addresses use them. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function isQueueId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** The stored list, or an empty one when nothing is stored or what is there is not a list of ids. */
export function parseQueue(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueueId).filter((id, index, all) => all.indexOf(id) === index);
  } catch {
    return [];
  }
}

/** Appends `id` unless it is queued already or is the item playing now. */
export function addToQueue(ids: readonly string[], id: string, currentId: string | null): string[] {
  if (!isQueueId(id) || id === currentId || ids.includes(id)) return [...ids];
  return [...ids, id];
}

export function removeFromQueue(ids: readonly string[], id: string): string[] {
  return ids.filter((queued) => queued !== id);
}

/**
 * Moves the item at `from` to `to`, both clamped to the list, the others keeping their order. Out of
 * range or unmoved, the list comes back as it was.
 */
export function moveInQueue(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length || !Number.isInteger(from) || !Number.isInteger(to)) {
    return next;
  }
  const target = Math.min(Math.max(to, 0), next.length - 1);
  if (target === from) return next;
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(target, 0, moved);
  return next;
}

/** What starts when the current item ends, and the queue left after it. */
export function takeNext(
  ids: readonly string[],
  currentId: string | null,
): { next: string | null; rest: string[] } {
  const rest = ids.filter((id) => id !== currentId);
  const [next = null, ...after] = rest;
  return { next, rest: after };
}

/** Where an item's page lives. */
export function queueItemUrl(id: string): string {
  return id.startsWith("ep-") ? `/e/${id}` : `/d/${id}`;
}

export interface PlayQueue {
  getIds(): readonly string[];
  /** Appends `id`; false when it was refused (queued already, or the item playing now). */
  add(id: string): boolean;
  remove(id: string): void;
  /** Moves a queued item to another place in the order. */
  move(from: number, to: number): void;
  /** Drops the item that has just started, so the queue holds only what is still to come. */
  started(id: string): void;
  /** Takes the first queued item off the queue and returns it, or null when there is none. */
  shift(currentId: string | null): string | null;
  subscribe(listener: () => void): () => void;
}

export function createPlayQueue(options: {
  storage: StorageLike | null;
  getCurrentId: () => string | null;
  onChange?: (ids: readonly string[]) => void;
}): PlayQueue {
  const { storage } = options;
  let ids: readonly string[] = [];
  try {
    ids = parseQueue(storage?.getItem(QUEUE_KEY) ?? null);
  } catch {
    ids = [];
  }
  const listeners = new Set<() => void>();

  function set(next: readonly string[]): void {
    if (next.length === ids.length && next.every((id, index) => id === ids[index])) return;
    ids = next;
    try {
      if (ids.length > 0) storage?.setItem(QUEUE_KEY, JSON.stringify(ids));
      else storage?.removeItem(QUEUE_KEY);
    } catch {
      // Full or blocked storage: the queue still works until the page is reloaded.
    }
    for (const listener of listeners) listener();
    options.onChange?.(ids);
  }

  return {
    getIds: () => ids,
    add(id) {
      const before = ids.length;
      set(addToQueue(ids, id, options.getCurrentId()));
      return ids.length > before;
    },
    remove: (id) => set(removeFromQueue(ids, id)),
    move: (from, to) => set(moveInQueue(ids, from, to)),
    started: (id) => set(removeFromQueue(ids, id)),
    shift(currentId) {
      const { next, rest } = takeNext(ids, currentId);
      set(rest);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
