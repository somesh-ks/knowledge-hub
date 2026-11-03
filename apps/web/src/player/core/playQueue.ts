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
/**
 * What the listener took off the queue: Suggested and Autoplay leave it out until it is queued or
 * played again (owner, 2026-11-03: a removed podcast came back on top of Suggested).
 */
export const REMOVED_KEY = "singularity:queue-removed";
export const QUEUE_ADD_EVENT = "singularity:queue-add";
export const QUEUE_CHANGED_EVENT = "singularity:queue-changed";

/** A briefing or episode id: letters, digits and dashes, as the pages' addresses use them. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function isQueueId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** The removed ids, newest last; anything unreadable is nothing removed. */
export function parseRemoved(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter(isQueueId) : [];
  } catch {
    return [];
  }
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
  /** The rows the listener put above the item playing now, in order (D357). They play only when chosen. */
  getAbove(): readonly string[];
  /** All four as one object that is replaced by every change, for a view to subscribe to. */
  getView(): QueueView;
  /**
   * Appends `id`; false when it was refused (queued already, or the item playing now). A row put
   * above the playing one comes down to the end, to be played.
   */
  add(id: string): boolean;
  remove(id: string): void;
  /**
   * The listed rows (above, the one playing, to come) in a new order, as a drag leaves them: the
   * rows over the playing one go above it, the rest are to come (D357). Anything but the same rows
   * reordered is refused. Without the playing row (it is not shown), every row is to come.
   */
  arrange(order: readonly string[]): void;
  /**
   * The item `id` has started. It becomes the current one and the list keeps its order: what was
   * current, and anything skipped to reach `id`, joins the played items; jumping back to a played
   * item, or up to a row above, puts the ones after it back to come. An item the list does not hold
   * becomes current beside it. Rows above stay above (D357).
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
  /** Listed over the playing row, put there by the listener (D357); empty while nothing is current. */
  above: readonly string[];
}

/** Every listed row in the list's order: above, the one playing, then what is to come. */
export function listedIds(view: QueueView): string[] {
  return [...view.above, ...(view.current ? [view.current] : []), ...view.upcoming];
}

export interface QueueHistory {
  played: string[];
  current: string | null;
  above: string[];
}

/** The stored played items and the current one, or nothing when what is stored is not that. */
export function parseHistory(raw: string | null): QueueHistory {
  const empty: QueueHistory = { played: [], current: null, above: [] };
  if (!raw) return empty;
  const ids = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter(isQueueId).filter((id, index, all) => all.indexOf(id) === index)
      : [];
  try {
    const parsed = JSON.parse(raw) as {
      played?: unknown;
      current?: unknown;
      above?: unknown;
    } | null;
    const current = isQueueId(parsed?.current) ? parsed.current : null;
    const above = ids(parsed?.above).filter((id) => id !== current);
    const played = ids(parsed?.played).filter((id) => id !== current && !above.includes(id));
    return { played, current, above };
  } catch {
    return empty;
  }
}

type QueueState = {
  played: readonly string[];
  current: string | null;
  upcoming: readonly string[];
  above?: readonly string[];
};
type StartedState = { played: string[]; current: string; upcoming: string[]; above: string[] };

/** The pointer move, on a list that holds each item once. */
function startItemOnce(state: Required<QueueState>, id: string): StartedState {
  const { played, current, upcoming, above } = state;
  const was = current ? [current] : [];
  if (id === current)
    return { played: [...played], current: id, upcoming: [...upcoming], above: [...above] };
  const up = above.indexOf(id);
  if (up >= 0) {
    // Up to a row above (D357): the list keeps its order, and the rows under it are to come again.
    return {
      played: [...played],
      current: id,
      upcoming: [...above.slice(up + 1), ...was, ...upcoming],
      above: above.slice(0, up),
    };
  }
  const at = upcoming.indexOf(id);
  if (at >= 0) {
    // Jumped ahead: what was skipped over has been passed. The rows above stay where they were put.
    return {
      played: [...played, ...was, ...upcoming.slice(0, at)],
      current: id,
      upcoming: upcoming.slice(at + 1),
      above: [...above],
    };
  }
  const back = played.indexOf(id);
  if (back >= 0) {
    // Jumped back: what followed it is to come again, in order, ahead of the rest.
    return {
      played: played.slice(0, back),
      current: id,
      upcoming: [...played.slice(back + 1), ...was, ...upcoming],
      above: [...above],
    };
  }
  // Not in the list (a page's Play, a suggested item): it becomes current, and what was is behind it.
  return { played: [...played, ...was], current: id, upcoming: [...upcoming], above: [...above] };
}

/**
 * The list after `id` started (see PlayQueue.started): pure, so the rule is testable. `all` is
 * played, current, then to come; the pointer moves to `id` and nothing else changes order.
 */
export function startItem(state: QueueState, id: string): StartedState {
  // One place for each item, the first winning (current, then played, above, to come). The two
  // storage keys are read apart, and a reload forgets what played, so an item can come back listed
  // behind and ahead at once: the one that was current, queued again.
  const seen = new Set<string>(state.current ? [state.current] : []);
  const once = (ids: readonly string[]): string[] =>
    ids.filter((entry) => !seen.has(entry) && (seen.add(entry), true));
  const played = once(state.played);
  const above = once(state.above ?? []);
  const upcoming = once(state.upcoming);
  return startItemOnce({ played, current: state.current, upcoming, above }, id);
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
  let history: QueueHistory = { played: [], current: null, above: [] };
  try {
    history = parseHistory(storage?.getItem(HISTORY_KEY) ?? null);
  } catch {
    history = { played: [], current: null, above: [] };
  }
  const listeners = new Set<() => void>();
  /** A new object for each change, so a view that reads the played items sees it. */
  let played: readonly string[] = history.played;
  let current: string | null = history.current;
  /** Rows over the playing one (D357). Only while something is current; else they head what is to come. */
  let above: readonly string[] = history.above.filter((id) => !ids.includes(id));
  if (!current && above.length > 0) {
    ids = [...above, ...ids];
    above = [];
    // Stored where they now stand, or a reload would list a row removed since from the old history.
    try {
      storage?.setItem(QUEUE_KEY, JSON.stringify(ids));
    } catch {
      // Full or blocked storage: the queue still works until the page is reloaded.
    }
    persistHistory();
  }

  function persistHistory(): void {
    try {
      if (played.length > 0 || current)
        storage?.setItem(
          HISTORY_KEY,
          JSON.stringify(above.length > 0 ? { played, current, above } : { played, current }),
        );
      else storage?.removeItem(HISTORY_KEY);
    } catch {
      // Full or blocked storage: the list still works until the page is reloaded.
    }
  }

  /** Notes `id` as taken off (or, `false`, as back), before the change is told: Suggested reads it. */
  function markRemoved(id: string, removed: boolean): void {
    try {
      const was = parseRemoved(storage?.getItem(REMOVED_KEY) ?? null);
      if (!removed && !was.includes(id)) return;
      const rest = was.filter((entry) => entry !== id);
      // Unbounded: an id leaves only when it is queued or played again, and the catalogue is small.
      const next = removed ? [...rest, id] : rest;
      if (next.length > 0) storage?.setItem(REMOVED_KEY, JSON.stringify(next));
      else storage?.removeItem(REMOVED_KEY);
    } catch {
      // Full or blocked storage: the item may be suggested again.
    }
  }

  let view: QueueView = { played, current, upcoming: ids, above };

  function tell(): void {
    view = { played, current, upcoming: ids, above };
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
    getAbove: () => above,
    getView: () => view,
    add(id) {
      const before = ids.length;
      markRemoved(id, false);
      if (above.includes(id)) {
        above = above.filter((entry) => entry !== id);
        persistHistory();
      }
      // Queued again, an item that already played comes out of the history and goes to the end.
      if (played.includes(id) && id !== (options.getCurrentId() ?? current)) {
        played = played.filter((entry) => entry !== id);
        persistHistory();
      }
      set(addToQueue(ids, id, options.getCurrentId()));
      return ids.length > before;
    },
    remove(id) {
      markRemoved(id, true);
      // The item playing now leaves the list and plays on: nothing is queued behind it for it. The
      // rows above it keep their places, at the head of what is to come.
      if (id === current) {
        current = null;
        const lifted = above;
        above = [];
        persistHistory();
        if (lifted.length > 0) set([...lifted, ...ids]);
        else tell();
        return;
      }
      if (above.includes(id)) {
        above = above.filter((entry) => entry !== id);
        persistHistory();
        tell();
        return;
      }
      if (played.includes(id)) {
        played = played.filter((entry) => entry !== id);
        persistHistory();
        tell();
        return;
      }
      set(removeFromQueue(ids, id));
    },
    arrange(order) {
      // The playing row is not drawn while another item is only loaded: its rows are plain rows then.
      const hidden = current !== null && !order.includes(current);
      const listed = listedIds(view).filter((id) => !hidden || id !== current);
      if (
        order.length !== listed.length ||
        new Set(order).size !== order.length ||
        !order.every((id) => listed.includes(id))
      )
        return;
      const at = current && !hidden ? order.indexOf(current) : -1;
      const nextAbove = at > 0 ? order.slice(0, at) : [];
      const sameAbove =
        nextAbove.length === above.length && nextAbove.every((id, index) => id === above[index]);
      if (!sameAbove) {
        above = nextAbove;
        persistHistory();
      }
      const before = ids;
      set(order.slice(at + 1));
      if (!sameAbove && before === ids) tell();
    },
    started(id) {
      markRemoved(id, false);
      const next = startItem({ played, current, upcoming: ids, above }, id);
      const trimmed = next.played.slice(-HISTORY_LIMIT);
      const sameAbove =
        next.above.length === above.length && next.above.every((e, i) => e === above[i]);
      const same =
        sameAbove &&
        next.current === current &&
        trimmed.length === played.length &&
        trimmed.every((entry, index) => entry === played[index]) &&
        next.upcoming.length === ids.length &&
        next.upcoming.every((entry, index) => entry === ids[index]);
      if (same) return;
      played = trimmed;
      current = next.current;
      above = next.above;
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
