import { getPreferences, type MoodPreference, type ThemePreference } from "./preferences";
import { applyHue, applyMood, applyTheme, changeTheme } from "./themeApply";

let subscribers = 0;
let stop: (() => void) | null = null;
let applied: { theme: ThemePreference; mood: MoodPreference; hue: number } | null = null;

/**
 * Keeps <html data-theme>, <html data-style> and the hue turn in step with the preferences. The first application is instant; later
 * changes crossfade through a view transition. Both islands call this and share one subscription,
 * so the theme works with either of them mounted.
 */
export function startThemeSync(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    const preferences = getPreferences();
    const { theme, mood, hue } = preferences.get();
    applied = { theme, mood, hue };
    applyTheme(theme);
    applyMood(mood);
    applyHue(mood, hue);
    stop = preferences.subscribe(() => {
      const next = preferences.get();
      const sameLook = next.theme === applied?.theme && next.mood === applied.mood;
      const before = applied;
      applied = { theme: next.theme, mood: next.mood, hue: next.hue };
      if (sameLook) {
        // A turn of the hue follows the slider's thumb: it is not a change of look, so it does not crossfade.
        if (next.hue !== before?.hue) applyHue(next.mood, next.hue);
        return;
      }
      changeTheme(next.theme, next.mood);
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

/** After a navigation replaced the root attributes, the applied theme and mood are written again. */
export function reapplyTheme(): void {
  if (!applied) return;
  applyTheme(applied.theme);
  applyMood(applied.mood);
  applyHue(applied.mood, applied.hue);
}
