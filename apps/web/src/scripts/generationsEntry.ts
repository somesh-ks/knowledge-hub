/**
 * What the shell knows of the generations list without loading it (components/GenerationsMenu.astro):
 * the panel opens by itself, as a popover does, and its script (generations.ts) is fetched when the
 * list is first opened, or when this browser has started a run. A visit that does neither costs
 * nothing: the list is not asked for on every page, since asking spends GitHub calls.
 */
import { GENERATION_STARTED_EVENT, RUN_STORAGE_KEY } from "../lib/runRecord";

let installed = false;

export function installGenerationsEntry(): void {
  if (installed) return;
  installed = true;
  const load = () =>
    import("./generations").then((module) => module.mountGenerations()).catch(() => undefined);

  // beforetoggle does not bubble but does capture; the panel is opened before the script is here.
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const panel = event.target as Element | null;
      if (panel?.id === "generations" && (event as ToggleEvent).newState === "open") void load();
    },
    true,
  );
  document.addEventListener(GENERATION_STARTED_EVENT, () => void load());
  document.addEventListener("astro:page-load", () => {
    try {
      if (localStorage.getItem(RUN_STORAGE_KEY)) void load();
    } catch {
      // Storage can be blocked: no run is remembered, and the list waits to be opened.
    }
  });
  addEventListener("storage", (event) => {
    if (event.key === RUN_STORAGE_KEY) void load();
  });
}
