import {
  DEFAULT_MOOD,
  getPreferences,
  type MoodPreference,
  type ThemePreference,
} from "./preferences";
import { setRootAttribute, setRootProperty } from "./rootAttributes";

/** `data-theme` is absent for "system", so the media query decides. */
export function applyTheme(theme: ThemePreference): void {
  setRootAttribute("data-theme", theme === "system" ? null : theme);
}

/**
 * The mood's attribute is absent for the default, so the base tokens apply. It is written under both
 * names, `data-style` and `data-mood`, while the stylesheets move from the first to the second (D327);
 * the old one goes when no stylesheet reads it.
 */
export function applyMood(mood: MoodPreference): void {
  const value = mood === DEFAULT_MOOD ? null : mood;
  setRootAttribute("data-style", value);
  setRootAttribute("data-mood", value);
}

/**
 * The reader's turn of a mood's hue (D315) is `--hue-shift` on the root: the mood's colours, the
 * covers and the header light add it to their hue. Default has no hue to turn, so it carries none.
 */
export function applyHue(mood: MoodPreference, hue: number): void {
  setRootProperty("--hue-shift", mood === DEFAULT_MOOD || hue === 0 ? null : String(hue));
}

/** Counts theme changes, so only the last one clears the crossfade's mark. */
let changes = 0;

/**
 * A theme or mood change crossfades through the View Transitions API where it exists (the retired design-spec.md,
 * Settings). Without the API it is an instant swap, which is correct, only plainer. During the
 * crossfade `data-theme-change` is on the root, and the whole window fades as one picture
 * (view-transitions.css). Covers are vectors the page colours (D314), so nothing waits for them.
 */
export function changeTheme(theme: ThemePreference, mood: MoodPreference): void {
  changes += 1;
  const change = changes;
  const apply = (): void => {
    applyTheme(theme);
    applyMood(mood);
    // The hue is read as the change lands, so a turn made meanwhile is not put back.
    applyHue(mood, getPreferences().get().hue);
  };
  if (typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-theme-change", "");
  // A second change during the crossfade skips the first transition, which rejects its promises.
  // That is the intended outcome, not an error.
  const transition = document.startViewTransition(apply);
  transition.ready.catch(() => {});
  transition.finished
    .catch(() => {})
    .then(() => {
      if (change === changes) root.removeAttribute("data-theme-change");
    });
}
