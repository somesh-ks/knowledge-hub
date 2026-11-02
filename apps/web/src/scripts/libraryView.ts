/**
 * The Library's layout, list by default and the gallery when this device chose it (2026-11-02, the
 * owner). Applied at every swap into the Library, before the cover morph measures where a card
 * lands: the page's own script runs after that, and the morph would fly to a gallery card's box and
 * then watch the page turn into a list. Settings > Downloads and Saved hard-code their list and never
 * read this key.
 */
export const VIEW_KEY = "singularity:library-view";

export type LibraryView = "list" | "gallery";

/** What this device chose; storage that fails or says nothing leaves the list. */
export function storedView(): LibraryView {
  try {
    return localStorage.getItem(VIEW_KEY) === "gallery" ? "gallery" : "list";
  } catch {
    return "list";
  }
}

/** Sets the view on the Library's root and on its switch. */
export function applyView(root: HTMLElement, view: LibraryView): void {
  root.dataset.view = view;
  for (const button of root.querySelectorAll<HTMLElement>("[data-library-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.libraryView === view));
  }
}

/** The Library's root on the page now, not Settings' rows, which wear the same attribute. */
export function libraryRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#main.library [data-library]");
}

/**
 * Going back to a Library the gallery had scrolled, the browser puts the saved offset on a page whose
 * off-screen cards still count as their 240px estimate (library.css), so it is shorter than the page
 * that was left and the offset is cut. The cards are drawn for two frames so each remembers its real
 * height, and the offset is put back; the card the cover flies home to is then where the page keeps it.
 */
function restoreOffset(root: HTMLElement): void {
  const saved = (history.state as { scrollX?: number; scrollY?: number } | null)?.scrollY ?? 0;
  if (saved <= scrollY) return;
  root.dataset.measuring = "";
  void root.offsetHeight;
  scrollTo(history.state?.scrollX ?? 0, saved);
  // A card keeps its size from a frame it was drawn in: two frames, then the page may skip again.
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-measuring")));
}

/** The incoming Library, at the swap: its server markup is the list, so a gallery device is set now. */
export function installLibraryViewSwap(): void {
  document.addEventListener("astro:after-swap", () => {
    const root = libraryRoot();
    if (!root) return;
    const view = storedView();
    applyView(root, view);
    if (view === "gallery") restoreOffset(root);
  });
}
