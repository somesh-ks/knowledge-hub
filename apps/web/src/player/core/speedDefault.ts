import { isPlaybackRate } from "./playerTypes";
import type { PreferencesStore } from "./preferences";
import type { StorageLike } from "./resume";

/** Episodes per speed, and the speeds already asked about. Local to this device, like the rest. */
export const SPEED_OFFER_KEY = "singularity:speed-offer";

/** The same speed, chosen in this many episodes, earns the offer. */
export const OFFER_AFTER_EPISODES = 3;

/** An episode's id list is capped, so the key stays small however long the listener stays. */
const MAX_IDS_PER_SPEED = 8;

interface OfferRecord {
  episodes: Record<string, string[]>;
  asked: string[];
  /** The speed on offer, kept so a page discarded before the answer still shows it next time. */
  pending?: string;
}

function parse(raw: string | null): OfferRecord {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<OfferRecord>) : {};
    const episodes: Record<string, string[]> = {};
    for (const [rate, ids] of Object.entries(value.episodes ?? {})) {
      if (Array.isArray(ids)) episodes[rate] = ids.filter((id) => typeof id === "string");
    }
    const asked = Array.isArray(value.asked) ? value.asked.map(String) : [];
    const pending = typeof value.pending === "string" ? value.pending : undefined;
    return { episodes, asked, ...(pending ? { pending } : {}) };
  } catch {
    return { episodes: {}, asked: [] };
  }
}

export interface SpeedDefault {
  /** The speed every episode starts at: the Settings choice, 1x if none. */
  getDefaultRate(): number;
  /** The listener chose `rate` in this episode. It changes this episode only; the last choice is the one counted. */
  noteRate(episodeId: string | null, rate: number): void;
  /** An episode ended at `rate`. */
  noteEnded(rate: number): void;
  /** Counts the episode in progress at its final speed. Called as the page hides. */
  flush(): void;
  /** The speed on offer as the new default, or null. */
  getPending(): number | null;
  /** Make Default: saves it and ends the offer. */
  accept(): void;
  /** Not now: ends the offer, and the same speed is never offered again. */
  dismiss(): void;
  subscribe(listener: () => void): () => void;
}

export function createSpeedDefault(options: {
  storage: StorageLike | null;
  preferences: Pick<PreferencesStore, "get" | "set">;
}): SpeedDefault {
  const { storage, preferences } = options;
  const listeners = new Set<() => void>();
  let pending: number | null = null;
  let record: OfferRecord = { episodes: {}, asked: [] };
  try {
    record = parse(storage?.getItem(SPEED_OFFER_KEY) ?? null);
  } catch {
    // Unreadable storage: the offer starts afresh for this session.
  }
  if (record.pending !== undefined) {
    const restored = Number(record.pending);
    // A rate already saved as the default (say, in Settings) is not offered again.
    if (isPlaybackRate(restored) && restored !== preferences.get().rate) pending = restored;
    else {
      const { pending: _stale, ...rest } = record;
      record = rest;
      save();
    }
  }

  function save(): void {
    try {
      storage?.setItem(SPEED_OFFER_KEY, JSON.stringify(record));
    } catch {
      // Best effort. The offer still holds for this session.
    }
  }

  function offer(rate: number): void {
    const key = String(rate);
    if (record.asked.includes(key)) return;
    // Asked once per speed: the offer counts as asked when shown, so Not now is final.
    record = { ...record, asked: [...record.asked, key], pending: key };
    save();
    pending = rate;
    for (const listener of listeners) listener();
  }

  function clearPending(): void {
    pending = null;
    if (record.pending === undefined) return;
    const { pending: _gone, ...rest } = record;
    record = rest;
    save();
  }

  function isOffRate(rate: number): boolean {
    return isPlaybackRate(rate) && rate !== preferences.get().rate;
  }

  // The slider reports every step. Only the speed an episode was left at counts, once.
  let chosen: { id: string; rate: number } | null = null;

  function uncount(last: { id: string; rate: number }): void {
    const key = String(last.rate);
    const ids = record.episodes[key] ?? [];
    if (!ids.includes(last.id)) return;
    record = {
      ...record,
      episodes: { ...record.episodes, [key]: ids.filter((id) => id !== last.id) },
    };
    save();
  }

  function commit(keep = false): void {
    const last = chosen;
    if (!keep) chosen = null;
    if (!last || !isOffRate(last.rate)) return;
    const key = String(last.rate);
    const ids = record.episodes[key] ?? [];
    if (ids.includes(last.id)) return;
    const next = [...ids, last.id].slice(-MAX_IDS_PER_SPEED);
    record = { ...record, episodes: { ...record.episodes, [key]: next } };
    save();
    if (next.length >= OFFER_AFTER_EPISODES) offer(last.rate);
  }

  return {
    getDefaultRate: () => preferences.get().rate,
    noteRate(episodeId, rate) {
      if (!episodeId) return;
      if (chosen && chosen.id !== episodeId) commit();
      if (chosen && chosen.rate !== rate) uncount(chosen);
      chosen = { id: episodeId, rate };
    },
    noteEnded(rate) {
      commit();
      if (isOffRate(rate)) offer(rate);
    },
    // A hide is not an end: the selection stays, and a later change of speed moves its count.
    flush: () => commit(true),
    getPending: () => pending,
    accept() {
      if (pending === null) return;
      preferences.set({ rate: pending });
      clearPending();
      for (const listener of listeners) listener();
    },
    dismiss() {
      clearPending();
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
