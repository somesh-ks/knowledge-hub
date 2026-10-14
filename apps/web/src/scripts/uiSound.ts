/**
 * Interface sounds for clicks and choices, one listener for the whole app. The decision (which cue
 * for which control) lives in a lazy module, fetched at idle or at the first gesture, so nothing here
 * costs first load beyond these few lines. A `dispatch:sound` event with detail "success" or "failure"
 * asks for the cue of an outcome the screen already states in words (saved, copied, refused).
 */
import { whenIdle } from "./idle";

export function installUiSound(): void {
  let loaded: Promise<typeof import("../player/sound/uiClicks")> | undefined;
  // The cues are a nicety: where the module cannot be fetched (offline, a dropped connection) the
  // gestures go without sound for the rest of the page. The failure is kept, not tried again: the
  // browser remembers a failed import and fails the next one at once, and Vite answers a failed
  // import, once online, by reloading the page, which would lose what the person was doing.
  const load = async () => {
    try {
      loaded ??= import("../player/sound/uiClicks");
      return await loaded;
    } catch {
      return null;
    }
  };
  // Heard in the capture phase, so a handler that stops the click (the tab bar's scroll to top)
  // cannot hide it, and one task later, so the page's own handlers have settled the control first.
  const route = (event: Event) =>
    setTimeout(() => void load().then((module) => module?.onUiEvent(event)));
  // Fetched at idle, or at a first gesture (a key or a focus included) before that, so the first
  // press is heard.
  whenIdle(() => void load());
  for (const type of ["pointerdown", "keydown", "focusin"])
    addEventListener(type, () => void load(), { once: true, passive: true });
  for (const type of ["click", "change", "dispatch:sound"])
    document.addEventListener(type, route, true);
}
