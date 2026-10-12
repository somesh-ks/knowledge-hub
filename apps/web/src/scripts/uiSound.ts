/**
 * Interface sounds for clicks and choices, one listener for the whole app. The decision (which cue
 * for which control) lives in a lazy module, fetched at the first gesture, so nothing here costs
 * first load beyond these few lines. A `dispatch:sound` event with detail "success" or "failure"
 * asks for the cue of an outcome the screen already states in words (saved, copied, refused).
 */
export function installUiSound(): void {
  let loaded: Promise<typeof import("../player/sound/uiClicks")> | undefined;
  // The cues are a nicety: where the module cannot be fetched (offline, a dropped connection) the
  // gesture goes without its sound, and the next one tries again.
  const load = async () => {
    try {
      loaded ??= import("../player/sound/uiClicks");
      return await loaded;
    } catch {
      loaded = undefined;
      return null;
    }
  };
  const route = (event: Event) => void load().then((module) => module?.onUiEvent(event));
  addEventListener("pointerdown", () => void load(), { once: true, passive: true });
  for (const type of ["click", "change", "dispatch:sound"]) document.addEventListener(type, route);
}
