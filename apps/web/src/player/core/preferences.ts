import { isFiniteNumber } from "./mathUtils";
import { isPlaybackRate, type PlaybackRate } from "./playerTypes";
import { type StorageLike, safeLocalStorage } from "./resume";
import { tabShared } from "./tabSlot";

/**
 * One JSON object under one key. The layout's inline theme script reads the same key before first
 * paint, so a change to its shape needs a matching change there.
 */
export const PREFERENCES_KEY = "singularity:preferences";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * The look this device chose: "default" or the name of a style in tokens.json (D268). Any
 * lowercase kebab-case word is kept, so a style added there needs no change here; a name no
 * style carries matches no CSS and looks like the default.
 */
export type StylePreference = string;
export const DEFAULT_STYLE: StylePreference = "default";

export interface Preferences {
  theme: ThemePreference;
  style: StylePreference;
  /** null until the listener chooses, so the reduced-motion default can apply. */
  sounds: boolean | null;
  /** Touch feedback (D273). On unless turned off; a device with no motor never shows the choice. */
  haptics: boolean;
  /** 0 to 1, before the engine's quadratic taper. */
  volume: number;
  /** The default speed: where every episode starts. A change in the player lasts one episode. */
  rate: PlaybackRate;
  /** When an item ends with an empty queue, the next suggested one starts. On unless turned off. */
  autoplay: boolean;
}

export const DEFAULT_VOLUME = 0.8;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  style: DEFAULT_STYLE,
  sounds: null,
  haptics: true,
  volume: DEFAULT_VOLUME,
  rate: 1,
  autoplay: true,
};

function isTheme(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

function isStyle(value: unknown): value is StylePreference {
  return typeof value === "string" && /^[a-z][a-z-]{0,23}$/.test(value);
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
    style: isStyle(record.style) ? record.style : DEFAULT_STYLE,
    sounds: typeof record.sounds === "boolean" ? record.sounds : null,
    haptics: typeof record.haptics === "boolean" ? record.haptics : DEFAULT_PREFERENCES.haptics,
    volume: isFiniteNumber(record.volume)
      ? Math.min(1, Math.max(0, record.volume))
      : DEFAULT_PREFERENCES.volume,
    rate: isPlaybackRate(record.rate) ? record.rate : DEFAULT_PREFERENCES.rate,
    autoplay: typeof record.autoplay === "boolean" ? record.autoplay : DEFAULT_PREFERENCES.autoplay,
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
  /** `defaultSoundsEnabled` from @singularity/sound: on, unless the system asks for reduced motion. */
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

/** Matches defaultSoundsEnabled() in @singularity/sound; used before that module has loaded. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * The app-wide store. Created on first use so importing this module costs nothing. One per tab
 * (tabSlot.ts): the runtime a first copy started reads it, and a newer copy's Settings writes it.
 */
export function getPreferences(): PreferencesStore {
  return tabShared("preferences", () =>
    createPreferencesStore({
      storage: safeLocalStorage(),
      defaultSounds: () => !prefersReducedMotion(),
    }),
  );
}
