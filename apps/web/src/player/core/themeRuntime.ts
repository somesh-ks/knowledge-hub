import { getPreferences, type StylePreference, type ThemePreference } from "./preferences";
import { applyStyle, applyTheme, changeTheme } from "./themeApply";

let subscribers = 0;
let stop: (() => void) | null = null;
let applied: { theme: ThemePreference; style: StylePreference } | null = null;

/**
 * Keeps <html data-theme> and <html data-style> in step with the preferences. The first application is instant; later
 * changes crossfade through a view transition. Both islands call this and share one subscription,
 * so the theme works with either of them mounted.
 */
export function startThemeSync(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    const preferences = getPreferences();
    const { theme, style } = preferences.get();
    applied = { theme, style };
    applyTheme(theme);
    applyStyle(style);
    stop = preferences.subscribe(() => {
      const next = preferences.get();
      if (next.theme === applied?.theme && next.style === applied.style) return;
      applied = { theme: next.theme, style: next.style };
      changeTheme(next.theme, next.style);
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

/** After a navigation replaced the root attributes, the applied theme and style are written again. */
export function reapplyTheme(): void {
  if (!applied) return;
  applyTheme(applied.theme);
  applyStyle(applied.style);
}
