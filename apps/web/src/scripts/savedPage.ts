/**
 * The Saved page: the podcasts this device saved from a player's menu (player/core/saved.ts). The
 * page carries every Library row, as Downloads does; this marks the saved ones (data-saved) and
 * orders them newest first. A row's menu removes it from Saved; the page hears the change through
 * the `singularity:saved` event.
 */
import { savedAt } from "../player/core/saved";
import { whenIdle } from "./idle";

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const grid = one("[data-library-grid]");
  const count = one("[data-count]");
  const section = one("[data-section]");
  const empty = one("[data-empty]");

  const storage = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  /** Marks the saved rows and puts the one saved last first. */
  const sync = (): void => {
    const store = storage();
    const cards = [...grid.querySelectorAll<HTMLElement>("[data-card]")];
    const saved = cards
      .map((card) => ({ card, at: savedAt(store, card.dataset.id ?? "") }))
      .filter((item): item is { card: HTMLElement; at: number } => item.at !== null)
      .sort((a, b) => b.at - a.at);
    for (const card of cards) card.toggleAttribute("data-saved", false);
    for (const { card } of saved) {
      card.setAttribute("data-saved", "");
      grid.append(card);
    }
    const shown = saved.length;
    count.textContent = shown === 0 ? "Nothing saved" : shown === 1 ? "1 saved" : `${shown} saved`;
    section.hidden = shown === 0;
    empty.hidden = shown > 0;
  };

  // The Library's own menu code, which Add to queue, Share and Remove from Saved need, comes at idle
  // or at the first touch of a row's menu.
  let menusLoaded = false;
  const loadMenus = (): void => {
    if (menusLoaded) return;
    menusLoaded = true;
    void import("./libraryMenu").then((menu) => menu.installLibraryMenu());
  };
  whenIdle(loadMenus);
  root.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest("[data-library-menu], [data-hero-more]")) loadMenus();
  });
  root.addEventListener("focusin", (event) => {
    if ((event.target as Element).closest("[data-library-menu], [data-hero-more]")) loadMenus();
  });
  window.addEventListener("singularity:saved", sync);
  // Another tab saved or removed one.
  window.addEventListener("storage", sync);
  // The router replaces the page: the listeners must not outlive the rows they read.
  document.addEventListener(
    "astro:before-swap",
    () => {
      window.removeEventListener("singularity:saved", sync);
      window.removeEventListener("storage", sync);
    },
    { once: true },
  );

  sync();
  root.dataset.ready = "";
}

export function installSavedPage(): void {
  const run = (): void => {
    const root = document.querySelector<HTMLElement>("[data-saved-page]");
    // Marked at once so a second call before then adds no second set of listeners.
    if (root && root.dataset.mounted === undefined) {
      root.dataset.mounted = "";
      mount(root);
    }
  };
  document.addEventListener("astro:page-load", run);
  run();
}
