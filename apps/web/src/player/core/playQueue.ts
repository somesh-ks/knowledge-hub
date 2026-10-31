import type { StorageLike } from "./resume";

/**
 * The play queue: what the listener chose to hear next, in order, as the ids the Library and the
 * pages use ("2026-10-07" for a briefing, "ep-20261007-1930" for an episode). It is kept in
 * localStorage so it survives a reload. When the playing item ends, the first queued one starts:
 * the listener asked for it, unlike the previous briefing, which Up next only offers.
 *
 * The Library's card menu talks to it through two document events:
 *   singularity:queue-add      detail { id }    append, unless queued already or playing now
 *   singularity:queue-changed  detail { ids }   sent after every change, from here
 */
export const QUEUE_KEY = "singularity:queue";
/**
 * What already played and what plays now, beside the queue (D277). The queue key keeps holding only
 * what is still to come, as it always did, so a tab on an older build reads it unchanged.
 */
export const HISTORY_KEY = "singularity:queue-played";
/** How many played items the list keeps behind the current one. */
export const HISTORY_LIMIT = 30;
export const QUEUE_ADD_EVENT = "singularity:queue-add";
export const QUEUE_CHANGED_EVENT = "singularity:queue-changed";

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
  /** What is still to come, in order. */
  getIds(): readonly string[];
  /** What played before the current item, oldest first. They stay listed, and a tap plays one again. */
  getPlayed(): readonly string[];
  /** The item playing now, or null before anything has played. */
  getCurrent(): string | null;
  /** All three as one object that is replaced by every change, for a view to subscribe to. */
  getView(): QueueView;
  /** Appends `id`; false when it was refused (queued already, or the item playing now). */
  add(id: string): boolean;
  remove(id: string): void;
  /** Moves a queued item to another place in the order. */
  move(from: number, to: number): void;
  /**
   * The item `id` has started. It becomes the current one and the list keeps its order: what was
   * current, and anything skipped to reach `id`, joins the played items; jumping back to a played
   * item puts the ones after it back to come. An item the list does not hold becomes current beside it.
   */
  started(id: string): void;
  /** Takes the first queued item off the queue and returns it, or null when there is none. */
  shift(currentId: string | null): string | null;
  subscribe(listener: () => void): () => void;
}

export interface QueueView {
  played: readonly string[];
  current: string | null;
  upcoming: readonly string[];
}

export interface QueueHistory {
  played: string[];
  current: string | null;
}

/** The stored played items and the current one, or nothing when what is stored is not that. */
export function parseHistory(raw: string | null): QueueHistory {
  const empty: QueueHistory = { played: [], current: null };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { played?: unknown; current?: unknown } | null;
    const played = Array.isArray(parsed?.played)
      ? parsed.played.filter(isQueueId).filter((id, index, all) => all.indexOf(id) === index)
      : [];
    const current = isQueueId(parsed?.current) ? parsed.current : null;
    return { played: played.filter((id) => id !== current), current };
  } catch {
    return empty;
  }
}

/**
 * The list after `id` started (see PlayQueue.started): pure, so the rule is testable. `all` is
 * played, current, then to come; the pointer moves to `id` and nothing else changes order.
 */
export function startItem(
  state: { played: readonly string[]; current: string | null; upcoming: readonly string[] },
  id: string,
): { played: string[]; current: string; upcoming: string[] } {
  const { played, current, upcoming } = state;
  if (id === current) return { played: [...played], current: id, upcoming: [...upcoming] };
  const at = upcoming.indexOf(id);
  if (at >= 0) {
    // Jumped ahead: what was skipped over has been passed.
    return {
      played: [...played, ...(current ? [current] : []), ...upcoming.slice(0, at)],
      current: id,
      upcoming: upcoming.slice(at + 1),
    };
  }
  const back = played.indexOf(id);
  if (back >= 0) {
    // Jumped back: what followed it is to come again, in order, ahead of the rest.
    return {
      played: played.slice(0, back),
      current: id,
      upcoming: [...played.slice(back + 1), ...(current ? [current] : []), ...upcoming],
    };
  }
  // Not in the list (a page's Play, a suggested item): it becomes current, and what was is behind it.
  return {
    played: [...played, ...(current ? [current] : [])],
    current: id,
    upcoming: [...upcoming],
  };
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
  let history: QueueHistory = { played: [], current: null };
  try {
    history = parseHistory(storage?.getItem(HISTORY_KEY) ?? null);
  } catch {
    history = { played: [], current: null };
  }
  const listeners = new Set<() => void>();
  /** A new object for each change, so a view that reads the played items sees it. */
  let played: readonly string[] = history.played;
  let current: string | null = history.current;

  function persistHistory(): void {
    try {
      if (played.length > 0 || current)
        storage?.setItem(HISTORY_KEY, JSON.stringify({ played, current }));
      else storage?.removeItem(HISTORY_KEY);
    } catch {
      // Full or blocked storage: the list still works until the page is reloaded.
    }
  }

  let view: QueueView = { played, current, upcoming: ids };

  function tell(): void {
    view = { played, current, upcoming: ids };
    for (const listener of listeners) listener();
    options.onChange?.(ids);
  }

  function set(next: readonly string[]): void {
    if (next.length === ids.length && next.every((id, index) => id === ids[index])) return;
    ids = next;
    try {
      if (ids.length > 0) storage?.setItem(QUEUE_KEY, JSON.stringify(ids));
      else storage?.removeItem(QUEUE_KEY);
    } catch {
      // Full or blocked storage: the queue still works until the page is reloaded.
    }
    tell();
  }

  return {
    getIds: () => ids,
    getPlayed: () => played,
    getCurrent: () => current,
    getView: () => view,
    add(id) {
      const before = ids.length;
      // Queued again, an item that already played comes out of the history and goes to the end.
      if (played.includes(id) && id !== (options.getCurrentId() ?? current)) {
        played = played.filter((entry) => entry !== id);
        persistHistory();
      }
      set(addToQueue(ids, id, options.getCurrentId()));
      return ids.length > before;
    },
    remove(id) {
      if (played.includes(id)) {
        played = played.filter((entry) => entry !== id);
        persistHistory();
        tell();
        return;
      }
      set(removeFromQueue(ids, id));
    },
    move: (from, to) => set(moveInQueue(ids, from, to)),
    started(id) {
      const next = startItem({ played, current, upcoming: ids }, id);
      const trimmed = next.played.slice(-HISTORY_LIMIT);
      const same =
        next.current === current &&
        trimmed.length === played.length &&
        trimmed.every((entry, index) => entry === played[index]) &&
        next.upcoming.length === ids.length &&
        next.upcoming.every((entry, index) => entry === ids[index]);
      if (same) return;
      played = trimmed;
      current = next.current;
      persistHistory();
      // The queue key follows only when what is to come changed.
      if (next.upcoming.length !== ids.length || next.upcoming.some((e, i) => e !== ids[i])) {
        set(next.upcoming);
        return;
      }
      tell();
    },
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
