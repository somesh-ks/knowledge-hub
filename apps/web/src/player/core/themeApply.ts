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

/** The longest a theme change waits for the covers on screen to be ready in the new theme. */
const COVER_WAIT_MS = 400;

/**
 * Each cover is drawn once per theme and the other theme's image is display: none, so a lazy one was
 * never fetched. A switch showed the covers on screen as empty boxes that filled in one by one after
 * the crossfade. The new theme's images on screen are fetched and decoded first, for at most
 * COVER_WAIT_MS; the ones off screen load lazily as before.
 */
function coversReady(theme: ThemePreference): Promise<unknown> {
  const dark =
    theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  const decoding: Promise<unknown>[] = [];
  const selector = `:is(.cover-image, .player-cover-image)[data-mode="${dark ? "dark" : "light"}"]`;
  for (const image of document.querySelectorAll<HTMLImageElement>(selector)) {
    const box = image.parentElement?.getBoundingClientRect();
    if (!box || box.width === 0 || box.bottom < 0 || box.top > innerHeight) continue;
    image.loading = "eager";
    decoding.push(image.decode().catch(() => {}));
  }
  if (decoding.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(decoding),
    new Promise((done) => setTimeout(done, COVER_WAIT_MS)),
  ]);
}

/** Counts theme changes, so one that waited on its covers never lands after a later one. */
let changes = 0;

/**
 * A theme or style change crossfades through the View Transitions API where it exists (the retired design-spec.md,
 * Settings). Without the API it is an instant swap, which is correct, only plainer. During the
 * crossfade `data-theme-change` is on the root, and the whole window fades as one picture
 * (view-transitions.css).
 */
export function changeTheme(theme: ThemePreference, style: StylePreference): void {
  changes += 1;
  const change = changes;
  void coversReady(theme).then(() => {
    if (change !== changes) return;
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
  });
}
