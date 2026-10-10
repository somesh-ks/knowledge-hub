import { isFiniteNumber } from "./mathUtils";
import { isPlaybackRate, type PlaybackRate } from "./playerTypes";
import { type StorageLike, safeLocalStorage } from "./resume";

/**
 * One JSON object under one key. The layout's inline theme script reads the same key before first
 * paint, so a change to its shape needs a matching change there.
 */
export const PREFERENCES_KEY = "dispatch:preferences";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export interface Preferences {
  theme: ThemePreference;
  /** null until the listener chooses, so the reduced-motion default can apply. */
  sounds: boolean | null;
  /** 0 to 1, before the engine's quadratic taper. */
  volume: number;
  rate: PlaybackRate;
}

export const DEFAULT_VOLUME = 0.8;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  sounds: null,
  volume: DEFAULT_VOLUME,
  rate: 1,
};

function isTheme(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Tolerates anything: a stale shape, hand-edited JSON, a value from a future version. */
export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFERENCES;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;
  const record = parsed as Record<string, unknown>;
  return {
    theme: isTheme(record.theme) ? record.theme : DEFAULT_PREFERENCES.theme,
    sounds: typeof record.sounds === "boolean" ? record.sounds : null,
    volume: isFiniteNumber(record.volume)
      ? Math.min(1, Math.max(0, record.volume))
      : DEFAULT_PREFERENCES.volume,
    rate: isPlaybackRate(record.rate) ? record.rate : DEFAULT_PREFERENCES.rate,
  };
}

export function serializePreferences(preferences: Preferences): string {
  return JSON.stringify(preferences);
}

export interface PreferencesStore {
  /** A stable snapshot: the same object until a preference changes. */
  get(): Preferences;
  set(patch: Partial<Preferences>): void;
  /** The Sounds switch as the engine sees it: the listener's choice, or the reduced-motion default. */
  getSoundsEnabled(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface PreferencesStoreOptions {
  storage: StorageLike | null;
  /** `defaultSoundsEnabled` from @dispatch/sound: on, unless the system asks for reduced motion. */
  defaultSounds: () => boolean;
}

export function createPreferencesStore(options: PreferencesStoreOptions): PreferencesStore {
  const { storage, defaultSounds } = options;
  const listeners = new Set<() => void>();
  let current = DEFAULT_PREFERENCES;
  try {
    current = parsePreferences(storage?.getItem(PREFERENCES_KEY) ?? null);
  } catch {
    current = DEFAULT_PREFERENCES;
  }

  return {
    get: () => current,
    getSoundsEnabled: () => current.sounds ?? defaultSounds(),
    set(patch) {
      const next: Preferences = { ...current, ...patch };
      const changed = (Object.keys(next) as (keyof Preferences)[]).some(
        (key) => next[key] !== current[key],
      );
      if (!changed) return;
      current = next;
      try {
        storage?.setItem(PREFERENCES_KEY, serializePreferences(next));
      } catch {
        // Storage is best effort. The change still applies for this session.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Keeps the speed the player moved to for next time: any step the slider reaches, not only a preset. */
export function rememberRate(preferences: Pick<PreferencesStore, "set">, rate: number): void {
  if (isPlaybackRate(rate)) preferences.set({ rate });
}

/** Matches defaultSoundsEnabled() in @dispatch/sound; used before that module has loaded. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

let shared: PreferencesStore | null = null;

/** The app-wide store. Created on first use so importing this module costs nothing. */
export function getPreferences(): PreferencesStore {
  shared ??= createPreferencesStore({
    storage: safeLocalStorage(),
    defaultSounds: () => !prefersReducedMotion(),
  });
  return shared;
}
