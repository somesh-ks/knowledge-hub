/**
 * The Topics pages' own script (the list and each topic's page), kept to what has to answer at once:
 * the weight readout, the More menu and the site icons. Everything that edits (recording a change,
 * the Add source panel, saving) is topicsEditor.ts, loaded the first time one of those controls is
 * used, so a page's first load stays inside the budget. Each page is whole static HTML without it.
 */

import { hasSaved, storeOn } from "../lib/savedKey";
import { drawStop } from "../lib/weightStops";
import { warmWhenIdle } from "./idle";
import { installMultiSelect } from "./multiSelect";

type Editor = { handle(event: Event): void };

function mount(root: HTMLElement): void {
  let editor: Promise<Editor> | undefined;
  // An edit saved in the last few minutes is not in this page until the next build: the controls
  // show it first (savedView.ts), and the editor then reads it as their starting point.
  // An edit a left page's run still holds loads the editor at once: it takes the edit if that run fails.
  // The page for a topic not built yet takes it from what was saved first (D142).
  // With the config store on (D149), what it holds is laid over the page the same way, first.
  const shell = root.dataset.shell !== undefined;
  const store = storeOn();
  const saved =
    hasSaved() || shell || store
      ? import("./savedView")
          .then(async (module) => {
            if (store) await module.loadStore();
            if (shell && !module.fillShell(root)) return;
            module.overlayTopics(root);
            if (module.readPending()) void load();
          })
          .catch(() => {})
      : Promise.resolve();
  /** Loads the editor once. */
  const load = (): Promise<Editor> =>
    (editor ??= saved
      .then(() => import("./topicsEditor"))
      .then((module) => module.mountEditor(root)));
  // Fetched at idle, so the first edit finds the editor's code here and only mounts it.
  warmWhenIdle(() => import("./topicsEditor"));
  /** Every event goes to the editor, the first one loading it. */
  const forward = (event: Event): void => void load().then((loaded) => loaded.handle(event));

  const loaded = (image: HTMLImageElement): void => {
    if (image.naturalWidth > 0) image.dataset.loaded = "";
  };
  // An icon shows once it has loaded; one that never does leaves an empty slot. `load` does not bubble.
  root.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) loaded(event.target);
    },
    true,
  );
  for (const image of root.querySelectorAll<HTMLImageElement>("img[data-favicon]")) {
    if (image.complete) loaded(image);
  }

  // Sources or Preferences on a topic's page (2026-10-20), read from the address and kept in it, so
  // a reload or Back finds the same view (data-param, segmentedNav.ts).
  const tabs = root.querySelector<HTMLElement>("[data-topic-view]");
  if (tabs) {
    const view =
      new URLSearchParams(location.search).get("view") === "preferences"
        ? "preferences"
        : "sources";
    root.dataset.view = view;
    // The tabs show the view at once; their keys and presses (segmentedNav.ts) follow in a moment,
    // outside the first load's budget.
    for (const tab of tabs.children)
      tab.ariaSelected = String(tab.getAttribute("data-value") === view);
    void import("./segmentedNav").then((module) => {
      module.selectTab(tabs, view);
      module.mountSegmentedNav(tabs, (chosen) => {
        root.dataset.view = chosen;
      });
    });
  }

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-weight], [data-mix]")) {
      // The fill and the stop's name follow the thumb; recording the change waits for the editor.
      drawStop(target);
    }
    forward(event);
  });

  // Delete asks first (D103): the editor opens the confirm dialog (confirmTopic, topicsEditor.ts).
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    // The view's tabs are the page's own (mountSegmentedNav); the editor has nothing to do for them.
    if (!button || button.getAttribute("role") === "tab") return;
    if ("showAll" in button.dataset) {
      button.previousElementSibling?.setAttribute("data-all", "");
      button.hidden = true;
      return;
    }
    forward(event);
  });

  root.addEventListener("submit", (event) => {
    // A dialog's own form closes the dialog itself.
    if ((event.target as HTMLFormElement).method === "dialog") return;
    // The other forms have no address of their own; Enter in one must not reload the page.
    event.preventDefault();
    forward(event);
  });

  // The search and chips (sourceFilter.ts) read the address, so a reload or Back finds them set.
  if (root.querySelector("[data-filter]")) {
    void import("./sourceFilter").then((module) => module.mountFilter(root)).catch(() => {});
  }

  root.dataset.ready = "";
}

export function installTopicsPage(): void {
  installMultiSelect();
  // The topic card's More menu is the briefing page's popover menu. The popover opens without it;
  // its placement fallback and light dismiss come at idle, outside the first load's budget.
  warmWhenIdle(() => import("./heroMenu").then((module) => module.installHeroMenu()));
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-topics]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
