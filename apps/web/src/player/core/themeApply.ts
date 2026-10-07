import type { ThemePreference } from "./preferences";
import { setRootAttribute } from "./rootAttributes";

/** `data-theme` is absent for "system", so the media query decides. */
export function applyTheme(theme: ThemePreference): void {
  setRootAttribute("data-theme", theme === "system" ? null : theme);
}

/**
 * A theme change crossfades through the View Transitions API where it exists (design-spec.md,
 * Settings). Without the API it is an instant swap, which is correct, only plainer.
 */
export function changeTheme(theme: ThemePreference): void {
  if (typeof document.startViewTransition === "function") {
    // A second change during the crossfade skips the first transition, which rejects its promises.
    // That is the intended outcome, not an error.
    const transition = document.startViewTransition(() => applyTheme(theme));
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
    return;
  }
  applyTheme(theme);
}
