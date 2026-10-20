/**
 * The Topics pages' own script (the list and each topic's page), kept to what has to answer at once:
 * the weight readout, the More menu and the site icons. Everything that edits (recording a change,
 * the Add source panel, saving) is topicsEditor.ts, loaded the first time one of those controls is
 * used, so a page's first load stays inside the budget. Each page is whole static HTML without it.
 */

import { hasSaved } from "../lib/savedKey";
import { drawStop } from "../lib/weightStops";
import { installHeroMenu } from "./heroMenu";
import { warmWhenIdle } from "./idle";
import { installMultiSelect } from "./multiSelect";
import { mountSegmentedNav, selectTab } from "./segmentedNav";

type Editor = { handle(event: Event): void };

function mount(root: HTMLElement): void {
  let editor: Promise<Editor> | undefined;
  // An edit saved in the last few minutes is not in this page until the next build: the controls
  // show it first (savedView.ts), and the editor then reads it as their starting point.
  // An edit a left page's run still holds loads the editor at once: it takes the edit if that run fails.
  const saved = hasSaved()
    ? import("./savedView")
        .then((module) => {
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
  // a reload or Back finds the same view. The filter's own parameters stay.
  const showView = (view: string): void => {
    root.dataset.view = view;
  };
  const tabs = root.querySelector<HTMLElement>("[data-topic-view]");
  if (tabs) {
    const view =
      new URLSearchParams(location.search).get("view") === "preferences"
        ? "preferences"
        : "sources";
    selectTab(tabs, view);
    showView(view);
    mountSegmentedNav(tabs, (chosen) => {
      showView(chosen);
      const url = new URL(location.href);
      if (chosen === "preferences") url.searchParams.set("view", "preferences");
      else url.searchParams.delete("view");
      history.replaceState(history.state, "", url);
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

  // Delete asks first (D103): the menu's Delete opens the confirm dialog, and only its Delete
  // presses the menu item for the editor. Keep topic, the undo, goes straight through.
  const confirm = root.querySelector<HTMLDialogElement>("[data-topic-confirm]");
  let deleting: HTMLButtonElement | null = null;
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest("button");
    // The view's tabs are the page's own (mountSegmentedNav); the editor has nothing to do for them.
    if (!button || button.getAttribute("role") === "tab") return;
    if ("showAll" in button.dataset) {
      button.previousElementSibling?.setAttribute("data-all", "");
      button.hidden = true;
      return;
    }
    if (confirm && "confirm" in button.dataset && button.dataset.pressed !== "true") {
      deleting = button;
      confirm.showModal();
      return;
    }
    if ("confirmCancel" in button.dataset) {
      confirm?.close();
      return;
    }
    if ("confirmDelete" in button.dataset) {
      confirm?.close();
      const target = deleting;
      if (target)
        void load().then((loaded) => loaded.handle({ type: "click", target } as unknown as Event));
      return;
    }
    forward(event);
  });

  root.addEventListener("submit", (event) => {
    // The passphrase dialog is a form too, and closes itself.
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
  // The topic card's More menu is the briefing page's popover menu.
  installHeroMenu();
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-topics]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
