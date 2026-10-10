/**
 * The Topics & sources page's own script, kept to what has to answer at once: the score filter, the
 * sort, the weight readout and the site icons. Everything that edits (recording a change, the Add
 * source panel, the save bar) is topicsEditor.ts, loaded the first time one of those controls is
 * used, so the page's first load stays inside the budget. The page is whole static HTML without it.
 */

type Editor = { handle(event: Event): void };

/** Re-orders each topic's sources by name or by score (best first, New last, then by name). */
export function sortRows(list: Element, by: string): void {
  const rows = [...list.children] as HTMLElement[];
  const score = (row: HTMLElement): number => Number(row.dataset.score);
  const name = (row: HTMLElement): string => row.dataset.name ?? "";
  rows.sort((a, b) =>
    by === "name"
      ? name(a).localeCompare(name(b))
      : score(b) - score(a) || name(a).localeCompare(name(b)),
  );
  list.append(...rows);
}

function mount(root: HTMLElement): void {
  let editor: Promise<Editor> | undefined;
  /** Loads the editor once; every event after the first goes to it as well. */
  const forward = (event: Event): void => {
    editor ??= import("./topicsEditor").then((module) => module.mountEditor(root));
    void editor.then((loaded) => loaded.handle(event));
  };

  const loaded = (image: HTMLImageElement): void => {
    if (image.naturalWidth > 0) image.dataset.loaded = "";
  };
  // An icon shows once it has loaded; one that never does leaves its letter. `load` does not bubble.
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
    if (target.matches("[data-sort]")) {
      for (const list of root.querySelectorAll("[data-sources]")) sortRows(list, target.value);
    } else if (target.matches("[data-band-filter]")) {
      root.dataset.band = target.value || "all";
    } else forward(event);
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

  // A filter the browser kept from an earlier visit applies from the start.
  const bandFilter = root.querySelector<HTMLSelectElement>("select[data-band-filter]");
  if (bandFilter) root.dataset.band = bandFilter.value || "all";

  root.dataset.ready = "";
}

export function installTopicsPage(): void {
  const sync = (): void => {
    const root = document.querySelector<HTMLElement>("[data-topics]");
    if (root && root.dataset.ready === undefined) mount(root);
  };
  document.addEventListener("astro:page-load", sync);
  sync();
}
