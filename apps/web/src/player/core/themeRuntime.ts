import { getPreferences, type ThemePreference } from "./preferences";
import { applyTheme, changeTheme } from "./themeApply";

let subscribers = 0;
let stop: (() => void) | null = null;
let applied: ThemePreference | null = null;

/**
 * Keeps <html data-theme> in step with the preference. The first application is instant; later
 * changes crossfade through a view transition. Both islands call this and share one subscription,
 * so the theme works with either of them mounted.
 */
export function startThemeSync(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    const preferences = getPreferences();
    applied = preferences.get().theme;
    applyTheme(applied);
    stop = preferences.subscribe(() => {
      const next = preferences.get().theme;
      if (next === applied) return;
      applied = next;
      changeTheme(next);
    });
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) {
      stop?.();
      stop = null;
    }
  };
}

/** After a navigation replaced the root attributes, the applied theme is written again. */
export function reapplyTheme(): void {
  if (applied) applyTheme(applied);
}
