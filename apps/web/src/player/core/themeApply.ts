import { DEFAULT_STYLE, type StylePreference, type ThemePreference } from "./preferences";
import { setRootAttribute } from "./rootAttributes";

/** `data-theme` is absent for "system", so the media query decides. */
export function applyTheme(theme: ThemePreference): void {
  setRootAttribute("data-theme", theme === "system" ? null : theme);
}

/** `data-style` is absent for the default, so the base tokens apply. */
export function applyStyle(style: StylePreference): void {
  setRootAttribute("data-style", style === DEFAULT_STYLE ? null : style);
}

/** Counts theme changes, so only the last one clears the crossfade's mark. */
let changes = 0;

/**
 * A theme or style change crossfades through the View Transitions API where it exists (the retired design-spec.md,
 * Settings). Without the API it is an instant swap, which is correct, only plainer. During the
 * crossfade `data-theme-change` is on the root, and the whole window fades as one picture
 * (view-transitions.css). Covers are vectors the page colours (D311), so nothing waits for them.
 */
export function changeTheme(theme: ThemePreference, style: StylePreference): void {
  changes += 1;
  const change = changes;
  const apply = (): void => {
    applyTheme(theme);
    applyStyle(style);
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
