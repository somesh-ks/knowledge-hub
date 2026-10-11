/**
 * The Topics pages' own script (the list and each topic's page), kept to what has to answer at once:
 * the weight readout and the site icons. Everything that edits (recording a change, the Add source
 * panel, saving) is topicsEditor.ts, loaded the first time one of those controls is used, so a page's
 * first load stays inside the budget. Each page is whole static HTML without it.
 */

import { hasSaved } from "../lib/savedKey";
import { installMultiSelect } from "./multiSelect";

type Editor = { handle(event: Event): void };

function mount(root: HTMLElement): void {
  let editor: Promise<Editor> | undefined;
  // An edit saved in the last few minutes is not in this page until the next build: the controls
  // show it first (savedView.ts), and the editor then reads it as their starting point.
  const saved = hasSaved()
    ? import("./savedView").then((module) => void module.overlayTopics(root)).catch(() => {})
    : Promise.resolve();
  /** Loads the editor once; every event after the first goes to it as well. */
  const forward = (event: Event): void => {
    editor ??= saved
      .then(() => import("./topicsEditor"))
      .then((module) => module.mountEditor(root));
    void editor.then((loaded) => loaded.handle(event));
  };

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

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.matches("[data-weight]")) {
      // The fill and the readout follow the thumb; recording the change waits for the editor.
      const percent = `${Math.round(Number(target.value) * 100)}%`;
      target.style.setProperty("--range-fill", `${Number(target.value) * 100}%`);
      target.setAttribute("aria-valuetext", percent);
      const output = target.nextElementSibling;
      if (output) output.textContent = percent;
    }
    forward(event);
  });

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("button")) forward(event);
  });

  root.addEventListener("submit", (event) => {
    // The passphrase dialog is a form too, and closes itself.
    if ((event.target as HTMLFormElement).method === "dialog") return;
    // The other forms have no address of their own; Enter in one must not reload the page.
    event.preventDefault();
    forward(event);
  });

  root.dataset.ready = "";
}

export function installTopicsPage(): void {
  installMultiSelect();
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-topics]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
