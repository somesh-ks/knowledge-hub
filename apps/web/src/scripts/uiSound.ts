/**
 * Interface sounds for clicks and choices, one listener for the whole app. The decision (which cue
 * for which control) lives in a lazy module, fetched at the first gesture, so nothing here costs
 * first load beyond these few lines. A `dispatch:sound` event with detail "success" or "failure"
 * asks for the cue of an outcome the screen already states in words (saved, copied, refused).
 */
export function installUiSound(): void {
  let loaded: Promise<typeof import("../player/sound/uiClicks")> | undefined;
  const load = () => {
    loaded ??= import("../player/sound/uiClicks");
    return loaded;
  };
  const route = (event: Event) => void load().then((module) => module.onUiEvent(event));
  addEventListener("pointerdown", load, { once: true, passive: true });
  for (const type of ["click", "change", "dispatch:sound"]) document.addEventListener(type, route);
}
