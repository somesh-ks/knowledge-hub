/**
 * What an episode page knows about the More menu without loading Regenerate and Delete: the menu
 * itself (keys, focus, placement), and a pick loads the panel on demand. Both items are disabled,
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

const menu = () => document.getElementById("episode-menu");
const items = (list: HTMLElement) =>
  Array.from(list.querySelectorAll<HTMLElement>('[role="menuitem"]'));

function bindMenu(list: HTMLElement): void {
  const more = document.querySelector<HTMLElement>("[data-episode-more]");
  list.addEventListener("beforetoggle", (event) => {
    // Without anchor positioning the menu is placed from the button's box.
    if ((event as ToggleEvent).newState !== "open" || !more) return;
    if (CSS.supports("top", "anchor(bottom)")) return;
    const box = more.getBoundingClientRect();
    list.style.setProperty("--menu-top", `${box.bottom + 4}px`);
    list.style.setProperty("--menu-right", `${document.documentElement.clientWidth - box.right}px`);
  });
  list.addEventListener("toggle", (event) => {
    if ((event as ToggleEvent).newState === "open") items(list)[0]?.focus();
    // Escape or a pick: focus goes back to the button. A press elsewhere keeps its own focus.
    else if (list.contains(document.activeElement) || document.activeElement === document.body)
      more?.focus();
  });
  list.addEventListener("keydown", (event) => {
    const all = items(list);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to =
      event.key === "ArrowDown"
        ? at + 1
        : event.key === "ArrowUp"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? all.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  });
  // Tabbing out leaves nothing open behind.
  list.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !list.contains(next) && next !== more) list.hidePopover();
  });
}

let installed = false;

export function installEpisodeActions(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", (event) => {
    const trigger = (event.target as Element).closest<HTMLElement>("[data-episode-action]");
    if (!trigger) return;
    // Pick first closes the menu; the panel opens after.
    menu()?.hidePopover();
    void import("./episodeActions")
      .then((actions) => actions.openEpisodeAction(trigger))
      .catch(() => {});
  });
  const list = menu();
  if (list) bindMenu(list);
  document.addEventListener("dispatch:run", sync);
  document.addEventListener("astro:page-load", sync);
  sync();
}
