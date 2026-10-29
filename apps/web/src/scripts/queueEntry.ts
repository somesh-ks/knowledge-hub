/**
 * What the shell knows of the podcast queue without loading it (components/Queue.astro): the queue's
 * script (queue.ts) is fetched when this browser has a run on record or starts one, or when the
 * popover is first opened. A visit that does neither costs nothing: the list is not asked for on
 * every page, since asking spends GitHub calls.
 */
import { GENERATION_STARTED_EVENT, RUN_STORAGE_KEY } from "../lib/runRecord";

let installed = false;

export function installQueueEntry(): void {
  if (installed) return;
  installed = true;
  const load = () => import("./queue").then((module) => module.mountQueue()).catch(() => undefined);

  // beforetoggle does not bubble but does capture; the popover is opened before the script is here.
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const panel = event.target as Element | null;
      if (panel?.id === "queue-pop" && (event as ToggleEvent).newState === "open") void load();
    },
    true,
  );
  document.addEventListener(GENERATION_STARTED_EVENT, () => void load());
  document.addEventListener("astro:page-load", () => {
    try {
      if (localStorage.getItem(RUN_STORAGE_KEY)) void load();
    } catch {
      // Storage can be blocked: no run is remembered, and the queue waits to be opened.
    }
  });
  addEventListener("storage", (event) => {
    if (event.key === RUN_STORAGE_KEY) void load();
  });
}
