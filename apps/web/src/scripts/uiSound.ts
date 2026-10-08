/**
 * Interface sounds for clicks and choices, one listener for the whole app. The decision (which cue
 * for which control) lives in a lazy module, fetched at the first gesture, so nothing here costs
 * first load beyond these few lines.
 */
export function installUiSound(): void {
  let loaded: Promise<typeof import("../player/sound/uiClicks")> | undefined;
  const load = () => {
    loaded ??= import("../player/sound/uiClicks");
    return loaded;
  };
  const route = (event: Event) => void load().then((module) => module.onUiEvent(event));
  addEventListener("pointerdown", load, { once: true, passive: true });
  addEventListener("keydown", load, { once: true, passive: true });
  document.addEventListener("click", route);
  document.addEventListener("change", route);
  document.addEventListener("dispatch:sound", route);
}

/** An outcome the screen already states in words (saved, copied, refused): one cue to match. */
export function soundOutcome(kind: "success" | "failure"): void {
  document.dispatchEvent(new CustomEvent("dispatch:sound", { detail: kind }));
}
