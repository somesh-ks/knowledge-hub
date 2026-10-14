/**
 * What an episode page knows about Regenerate and Delete without loading them: the panel's code
 * loads at idle, and a pick in the More menu (scripts/heroMenu.ts closes it first) opens it. Both items are disabled,
 * with a reason, while a run for this episode goes and while the device is offline (both start work
 * that needs the network). The disabled state is aria-disabled, so they stay focusable and the
 * reason can be read; the shell's disabled guard swallows their clicks.
 */
import { warmWhenIdle } from "./idle";

const BUSY_ID = "episode-actions-busy";
/** The offline banner's line (BaseLayout.astro). */
const OFFLINE_ID = "offline-reason";

function sync(): void {
  const root = document.querySelector<HTMLElement>("[data-episode-actions]");
  if (!root) return;
  let busy = false;
  try {
    const run = JSON.parse(sessionStorage.getItem("dispatch:run") ?? "null");
    // A briefing's root has no episode: its runs are followed by the Generate sheet.
    busy =
      root.dataset.episode !== undefined &&
      run?.episode === root.dataset.episode &&
      (run?.phase === "queued" || run?.phase === "running");
  } catch {
    // Storage can be blocked; nothing is then known to be running.
  }
  const offline = !navigator.onLine;
  for (const button of root.querySelectorAll("[data-episode-action]")) {
    if (busy || offline) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-describedby", busy ? BUSY_ID : OFFLINE_ID);
    } else {
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-describedby");
    }
  }
}

let installed = false;

export function installEpisodeActions(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", (event) => {
    const trigger = (event.target as Element).closest<HTMLElement>("[data-episode-action]");
    if (!trigger) return;
    void import("./episodeActions")
      .then((actions) => actions.openEpisodeAction(trigger))
      .catch(() => {});
  });
  document.addEventListener("dispatch:run", sync);
  document.addEventListener("astro:page-load", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
  warmWhenIdle(() => import("./episodeActions"));
}
