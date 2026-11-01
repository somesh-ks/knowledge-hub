import { getPreferences, type StylePreference, type ThemePreference } from "./preferences";
import { applyHue, applyStyle, applyTheme, changeTheme } from "./themeApply";

let subscribers = 0;
let stop: (() => void) | null = null;
let applied: { theme: ThemePreference; style: StylePreference; hue: number } | null = null;

/**
 * Keeps <html data-theme>, <html data-style> and the hue turn in step with the preferences. The first application is instant; later
 * changes crossfade through a view transition. Both islands call this and share one subscription,
 * so the theme works with either of them mounted.
 */
export function startThemeSync(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    const preferences = getPreferences();
    const { theme, style, hue } = preferences.get();
    applied = { theme, style, hue };
    applyTheme(theme);
    applyStyle(style);
    applyHue(style, hue);
    stop = preferences.subscribe(() => {
      const next = preferences.get();
      const sameLook = next.theme === applied?.theme && next.style === applied.style;
      const before = applied;
      applied = { theme: next.theme, style: next.style, hue: next.hue };
      if (sameLook) {
        // A turn of the hue follows the slider's thumb: it is not a change of look, so it does not crossfade.
        if (next.hue !== before?.hue) applyHue(next.style, next.hue);
        return;
      }
      changeTheme(next.theme, next.style, next.hue);
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
  applyHue(applied.style, applied.hue);
}
