/**
 * What an episode page knows about Regenerate and Delete without loading them: a pick in the More
 * menu (scripts/heroMenu.ts closes it first) loads the panel on demand. Both items are disabled,
 * with a reason, while a run for this episode goes. The disabled state is aria-disabled, so they
 * stay focusable and the reason can be read; the shell's disabled guard swallows their clicks.
 */
const BUSY_ID = "episode-actions-busy";

function sync(): void {
  const root = document.querySelector<HTMLElement>("[data-episode-actions]");
  if (!root) return;
  let busy = false;
  try {
    const run = JSON.parse(sessionStorage.getItem("dispatch:run") ?? "null");
    busy =
      run?.episode === root.dataset.episode &&
      (run?.phase === "queued" || run?.phase === "running");
  } catch {
    // Storage can be blocked; nothing is then known to be running.
  }
  for (const button of root.querySelectorAll("[data-episode-action]")) {
    if (busy) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-describedby", BUSY_ID);
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
  sync();
}
