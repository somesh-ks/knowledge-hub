/**
 * The Downloads page: what this browser holds for offline listening. The page carries every
 * Library row; this marks the saved ones (data-downloaded, as the Library's menu does) and orders
 * them newest first. A row's menu removes one and Delete all removes every one, each after a confirm.
 * Both go through `removeDownload`, so the shared scripts and styles the pages kept go with the last.
 */
import { downloadsSummary, SEARCH_FROM } from "../lib/downloads";
import { normalize, textHasWords } from "../lib/library";
import { whenIdle } from "./idle";
import { readDownloads, removeAllDownloads, removeDownload } from "./libraryDownloads";
import { sendToast } from "./toastEvent";

interface Ask {
  title: string;
  lede: string;
  go: string;
  run: () => Promise<void>;
  done: string;
}

function mount(root: HTMLElement): void {
  const one = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    root.querySelector(selector) as T;
  const sections = [...root.querySelectorAll<HTMLElement>("[data-section]")];
  const grid = one("[data-library-grid]");
  const count = one("[data-count]");
  const empty = one("[data-empty]");
  const confirm = one<HTMLDialogElement>("dialog[data-confirm]");
  let ask: Ask | null = null;

  const form = one<HTMLFormElement>("[data-search-form]");
  const input = one<HTMLInputElement>("[data-search]");
  const clear = one<HTMLButtonElement>("[data-clear]");
  const nomatch = one("[data-nomatch]");
  const menu = one("[data-menu-wrap]");

  /** Hides the saved rows that do not match the words typed; with none typed, shows them all. */
  const filter = (): void => {
    const query = input.value;
    let found = 0;
    const saved = grid.querySelectorAll<HTMLElement>("[data-card][data-downloaded]");
    for (const card of saved) {
      const match =
        query.trim() === "" || textHasWords(normalize(card.dataset.search ?? ""), query);
      card.hidden = !match;
      if (match) found += 1;
    }
    clear.hidden = query === "";
    nomatch.hidden = found > 0 || saved.length === 0;
  };

  const draw = (): void => {
    const shown = grid.querySelectorAll("[data-card][data-downloaded]").length;
    count.textContent = downloadsSummary(shown);
    for (const section of sections) section.hidden = shown === 0;
    empty.hidden = shown > 0;
    // A short list needs no search; one typed into stays while rows go.
    form.hidden = shown < SEARCH_FROM && input.value === "";
    filter();
  };

  /** Marks the saved rows and puts the newest download first. */
  const sync = async (): Promise<void> => {
    const saved = (await readDownloads()).map((item) => item.id).reverse();
    const cards = [...grid.querySelectorAll<HTMLElement>("[data-card]")];
    for (const card of cards)
      card.toggleAttribute("data-downloaded", saved.includes(card.dataset.id ?? ""));
    for (const id of saved) {
      const card = cards.find((item) => item.dataset.id === id);
      if (card) grid.append(card);
    }
    // Delete all stays while anything is saved, even a copy of a podcast the Library no longer lists.
    menu.hidden = saved.length === 0;
    draw();
  };

  input.addEventListener("input", filter);
  form.addEventListener("submit", (event) => event.preventDefault());
  clear.addEventListener("click", () => {
    input.value = "";
    filter();
    input.focus();
  });

  const open = (next: Ask): void => {
    ask = next;
    one("[data-confirm-title]").textContent = next.title;
    one("[data-confirm-lede]").textContent = next.lede;
    one("[data-confirm-go]").textContent = next.go;
    confirm.showModal();
  };

  // The Library's menu removes a download at once; here the pick asks first. This runs before the
  // menu's own handler (document, bubbling) and keeps it from seeing the pick.
  grid.addEventListener(
    "click",
    (event) => {
      const item = (event.target as Element).closest<HTMLElement>('[data-menu="download"]');
      const card = item?.closest<HTMLElement>("[data-card]");
      if (!item || !card?.hasAttribute("data-downloaded")) return;
      event.stopPropagation();
      item.closest<HTMLElement>("[popover]")?.hidePopover();
      const id = card.dataset.id ?? "";
      const title = card.querySelector(".card-title")?.textContent?.trim() ?? "This podcast";
      open({
        title: "Remove download?",
        lede: `${title} is removed from this device only. You can download it again.`,
        go: "Remove",
        run: () => removeDownload(id),
        done: "Download removed",
      });
    },
    true,
  );
  one("[data-delete-all]").addEventListener("click", (event) => {
    (event.currentTarget as HTMLElement).closest<HTMLElement>("[popover]")?.hidePopover();
    open({
      title: "Delete all downloads?",
      lede: "They are removed from this device only. You can download them again, unless the podcast was deleted.",
      go: "Delete all",
      run: removeAllDownloads,
      done: "All downloads deleted",
    });
  });
  confirm.querySelector("[data-dialog-close]")?.addEventListener("click", () => confirm.close());
  one("[data-confirm-go]").addEventListener("click", () => {
    const pending = ask;
    confirm.close();
    if (!pending) return;
    void pending
      .run()
      .then(
        () => sendToast({ message: pending.done }),
        () => sendToast({ message: "Could not remove. Try again.", kind: "error" }),
      )
      // Whatever happened, show what is left.
      .then(sync);
  });

  // The Library's own menu code, which Add to queue and Share need, comes at idle or at the first touch of a row's menu.
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
  new MutationObserver(draw).observe(grid, {
    attributes: true,
    attributeFilter: ["data-downloaded"],
    subtree: true,
  });

  void sync().then(() => {
    root.dataset.ready = "";
  });
}

export function installDownloadsPage(): void {
  const run = (): void => {
    const root = document.querySelector<HTMLElement>("[data-downloads]");
    // Marked at once, not when the list is read, so a second call before then adds no second set of listeners.
    if (root && root.dataset.mounted === undefined) {
      root.dataset.mounted = "";
      mount(root);
    }
  };
  document.addEventListener("astro:page-load", run);
  run();
}
