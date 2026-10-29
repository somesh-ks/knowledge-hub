/**
 * The day's queue: the runs that ended (a podcast made, a failure, a stop) stay in the podcast queue
 * until the person clears it or the day changes. Kept in this browser, in localStorage, because a run
 * is followed by the browser that started it. Pure over a storage, so scripts/runStatus.ts (which
 * writes it when a run ends) and scripts/queue.ts (which draws it) share one shape.
 */
export const DAY_KEY = "singularity:queue-day";

/** The queue never holds more than this many ended runs: the newest stay. */
const KEEP = 20;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** An ended run, as the run indicator recorded it, and when it ended (epoch ms). */
export interface DayEntry<T extends { id: number }> {
  run: T;
  at: number;
}

/** The calendar day in the browser's zone: what "for the day" means to the person looking at it. */
const dayOf = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** True when `at` is on the same calendar day as `now`. */
export const isToday = (at: number, now = Date.now()): boolean => dayOf(at) === dayOf(now);

function parse<T extends { id: number }>(store: Store, now: number): DayEntry<T>[] {
  try {
    const value: unknown = JSON.parse(store.getItem(DAY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is DayEntry<T> =>
        typeof entry?.at === "number" &&
        typeof entry?.run?.id === "number" &&
        isToday(entry.at, now),
    );
  } catch {
    return [];
  }
}

function save<T extends { id: number }>(store: Store, entries: DayEntry<T>[]): void {
  try {
    if (entries.length) store.setItem(DAY_KEY, JSON.stringify(entries.slice(0, KEEP)));
    else store.removeItem(DAY_KEY);
  } catch {
    // Storage can be blocked or full; the queue then keeps only the run on record.
  }
}

/** Today's ended runs, newest first. Yesterday's are dropped. */
export function readDay<T extends { id: number }>(store: Store, now = Date.now()): DayEntry<T>[] {
  return parse<T>(store, now);
}

/**
 * Keep an ended run for the day. The same run again replaces its entry but keeps the time it first
 * ended, so calling this on every redraw is safe.
 */
export function remember<T extends { id: number }>(
  store: Store,
  run: T,
  at: number,
  now = Date.now(),
): void {
  const all = parse<T>(store, now);
  const before = all.find((entry) => entry.run.id === run.id);
  const entries = all.filter((entry) => entry.run.id !== run.id);
  entries.push({ run, at: before?.at ?? at });
  entries.sort((a, b) => b.at - a.at);
  save(store, entries);
}

/** Take one run out: it is going again (Check again) or was started over (Try again). */
export function forget(store: Store, id: number, now = Date.now()): void {
  const entries = parse(store, now);
  if (entries.some((entry) => entry.run.id === id)) {
    save(
      store,
      entries.filter((entry) => entry.run.id !== id),
    );
  }
}

/** Clear queue. */
export function clearDay(store: Store): void {
  try {
    store.removeItem(DAY_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
