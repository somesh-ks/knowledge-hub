import { useSyncExternalStore } from "react";
import { DEFAULT_PREFERENCES, getPreferences, type Preferences } from "../core/preferences";

function subscribe(onChange: () => void): () => void {
  return getPreferences().subscribe(onChange);
}

function getSnapshot(): Preferences {
  return getPreferences().get();
}

/** The persisted preferences. The server renders the defaults, so hydration always matches. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCES);
}
