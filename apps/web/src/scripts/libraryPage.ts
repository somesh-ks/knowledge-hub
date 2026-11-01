/**
 * The Library's search, sort and filter. The page is complete without this script: every briefing
 * is in the HTML, newest first. The script only hides, reorders and counts, and keeps each month's
 * heading before the first card of its month on show.
 */
import {
  type CardData,
  chipFilter,
  compareCards,
  EPISODE_KIND,
  emptyCopy,
  groupsByMonth,
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  type LibraryFilter,
  type LibrarySort,
  matchDetail,
  matchExcerpt,
  matchesFilter,
  monthOf,
  monthStarts,
  moreMatches,
  normalize,
  resultSummary,
  type SearchIndexEntry,
  storyHeadline,
  textHasWords,
} from "../lib/library";

import { whenIdle } from "./idle";

const VIEW_KEY = "singularity:library-view";
/** The Library's address with its search, filter and order, kept for the visit (episodeActions.ts reads it). */
const LIBRARY_URL_KEY = "singularity:library-url";

interface Card {
  id: string;
  element: HTMLElement;
  /** The card's search text as written, a line each: a matching story is named from it. */
  lines: string[];
  data: CardData;
}

function readCard(element: HTMLElement, order: number): Card {
  const { id = "", date = "", kind = "", minutes = "0", search = "" } = element.dataset;
  return {
    id,
    element,
    lines: search.split("\n"),
    data: {
      metaLines: Number(element.dataset.metaLines ?? "0"),
      date,
      order,
      kind,
      minutes: Number(minutes),
      search: normalize(search),
    },
  };
}

/** A value the URL may carry for a control, kept only when the control offers it. */
function allowed<T extends string>(
  value: string | null,
  options: ReadonlyArray<{ id: T }>,
): T | null {
  return options.find((option) => option.id === value)?.id ?? null;
}

function install(): void {
  // Only the Library page: this listener outlives it (astro:page-load), and Settings > Downloads wears the
  // same [data-library] rows. Wired there, it set the Library's stored view (the gallery) on it.
  const root = document.querySelector<HTMLElement>("#main.library [data-library]");
  if (!root || root.dataset.ready !== undefined) return;
  root.dataset.ready = "";

  const grid = root.querySelector<HTMLElement>("[data-library-grid]");
  const input = root.querySelector<HTMLInputElement>("[data-library-search]");
  const select = root.querySelector<HTMLSelectElement>("[data-library-sort]");
  const status = root.querySelector<HTMLElement>("[data-library-status]");
  const empty = root.querySelector<HTMLElement>("[data-library-empty]");
  const clearText = root.querySelector<HTMLButtonElement>("[data-library-clear-text]");
  const chips = [...root.querySelectorAll<HTMLInputElement>("[data-library-filter]")];
  const emptyMessage = root.querySelector<HTMLElement>("[data-library-empty-message]");
  const emptyButton = root.querySelector<HTMLButtonElement>("[data-library-clear]");
  let emptyReset: "search" | "everything" = "search";
  if (!grid) return;
  // Whether the order is offered here (library.css hides it on a phone). getComputedStyle, not
  // checkVisibility(), which Safari only has from 17.4.
  const sortField = select?.closest<HTMLElement>("[data-select]") ?? null;
  const sortShown = (): boolean =>
    sortField !== null && getComputedStyle(sortField).display !== "none";
  const cards = [...grid.querySelectorAll<HTMLElement>("[data-card]")].map(readCard);
  /** The month headings the page was built with, by month: the list shows them (library.css), the gallery does not. */
  const heads = new Map(
    [...grid.querySelectorAll<HTMLElement>("[data-month-head]")].map((head) => [
      head.dataset.month ?? "",
      head,
    ]),
  );

  /** The full text of every card, once fetched. Until then, and if it never comes, only the card's own lines are searched. */
  let fullText: Map<string, string> | null = null;
  let fetching = false;

  function loadFullText(): void {
    if (fullText || fetching) return;
    fetching = true;
    fetch("/search-index.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("no index"))))
      .then((entries: SearchIndexEntry[]) => {
        fullText = new Map(entries.map((entry) => [entry.id, entry.text]));
        apply();
      })
      .catch(() => {
        // Offline or missing: the search goes on with what the page holds, and does not ask again.
      });
  }

  /** A title the card cuts short gets the whole title as a tooltip; one that fits gets none. */
  function markTruncated(): void {
    for (const card of cards) {
      const title = card.element.querySelector<HTMLElement>(".card-title");
      const link = card.element.querySelector<HTMLElement>(".card-link");
      if (!title || !link || card.element.hidden) continue;
      if (title.scrollHeight > title.clientHeight + 1) link.title = title.textContent ?? "";
      else link.removeAttribute("title");
    }
  }

  /**
   * While searching, a line under a card's facts says why it is there: the matching story's
   * headline from a little before the find, the query's words in medium weight, and how many more
   * stories matched; or that a story's text mentions it. The facts (kind, length) stay in view.
   * Without a reason, the line goes.
   */
  function writeMatch(card: Card, query: string, headline?: string, more = 0): void {
    const anchor = card.element.querySelector<HTMLElement>(".card-sub");
    let line = card.element.querySelector<HTMLElement>("[data-card-match]");
    const key = headline === undefined ? "" : `${query}\n${headline}\n${more}`;
    if ((line?.dataset.shown ?? "") === key) return;
    if (headline === undefined) {
      line?.remove();
      return;
    }
    if (!line) {
      line = document.createElement("span");
      line.className = "card-match";
      line.dataset.cardMatch = "";
      anchor?.after(line);
    }
    line.dataset.shown = key;
    const parts = query === "" ? [{ text: headline, hit: false }] : matchExcerpt(headline, query);
    line.replaceChildren(
      ...parts.map((part) => {
        if (!part.hit) return document.createTextNode(part.text);
        const word = document.createElement("b");
        word.textContent = part.text;
        return word;
      }),
    );
    const rest = moreMatches(more);
    if (rest) {
      const tail = document.createElement("span");
      tail.className = "card-match-more";
      tail.textContent = ` ${rest}`;
      line.append(tail);
    }
  }

  /** The search, the filter and the order, in the address, so Back from a result restores them. */
  function writeUrl(query: string, filter: LibraryFilter, sort: LibrarySort): void {
    const url = new URL(location.href);
    const set = (name: string, value: string, fallback: string) => {
      if (value === fallback) url.searchParams.delete(name);
      else url.searchParams.set(name, value);
    };
    set("q", query, "");
    set("show", filter, "all");
    set("sort", sort, "newest");
    if (url.href !== location.href) history.replaceState(history.state, "", url);
    // Where the Library was left, for a move that comes back to it (a delete from an episode).
    try {
      sessionStorage.setItem(LIBRARY_URL_KEY, url.pathname + url.search);
    } catch {
      // Storage can be blocked; the move then goes to the plain Library.
    }
  }

  function apply(): void {
    const query = input?.value ?? "";
    const searching = query.trim() !== "";
    if (clearText) clearText.hidden = query === "";
    // A phone offers no order (library.css hides it), so one left in a link never reorders it unseen.
    const sort = (sortShown() ? (select?.value ?? "newest") : "newest") as LibrarySort;
    const filter = chipFilter(chips.filter((chip) => chip.checked).map((chip) => chip.value));
    // A narrowed order says so on its control, as a chosen chip does.
    select?.closest("[data-select]")?.toggleAttribute("data-active", sort !== "newest");
    // Only the cards still in the page: one this device deleted (deletedEpisodes.ts) may have been
    // taken out after this script read the list, and must not come back with a new order.
    const live = cards.filter((card) => card.element.isConnected);
    let shown = 0;
    for (const card of live) {
      const passes = matchesFilter(card.data, filter);
      const detail = passes ? matchDetail(card.data, query) : { meta: 0, stories: 0 };
      let matches = detail.meta + detail.stories;
      // A word that only the script or a story's text holds: the card is there, for another reason.
      const inText = passes && matches === 0 && textHasWords(fullText?.get(card.id) ?? "", query);
      if (inText) matches = 1;
      card.element.hidden = matches === 0;
      if (matches > 0) shown += 1;
      // While searching, a line says why a card is there, when a story is why. A card found by its
      // own date or title needs none: no story matched.
      if (searching && inText) {
        const said = card.data.kind === EPISODE_KIND ? "the episode" : "a story";
        writeMatch(card, "", `Mentioned in ${said}`);
      } else if (searching && matches > 0 && detail.stories > 0 && "first" in detail) {
        const headline = storyHeadline(card.lines[detail.first ?? 0] ?? "");
        writeMatch(card, query, headline, detail.stories - 1);
      } else writeMatch(card, query);
    }
    const ordered = [...live].sort((a, b) => compareCards(a.data, b.data, sort));
    for (const card of ordered) grid?.append(card.element);
    // A heading before the first card of each month on show, in a date order only; one whose month
    // has nothing on show (a filter, a search, a delete) is out of the page, never an empty heading.
    for (const head of heads.values()) {
      head.remove();
      head.removeAttribute("data-first");
    }
    if (groupsByMonth(sort)) {
      const onShow = ordered.filter((card) => !card.element.hidden);
      for (const [place, index] of monthStarts(onShow.map((card) => card.data.date)).entries()) {
        const card = onShow[index];
        const head = card && heads.get(monthOf(card.data.date));
        if (!card || !head) continue;
        grid?.insertBefore(head, card.element);
        // Cards a search hid may stand before it, so :first-child alone would miss the first on show.
        if (place === 0) head.setAttribute("data-first", "");
      }
    }
    if (status) status.textContent = resultSummary(shown, live.length);
    if (empty) {
      empty.hidden = shown > 0;
      // A search with no result puts the floating New episode away (library.css), said on the root
      // so a key restyles only the button, not the whole page (D147).
      document.documentElement.toggleAttribute("data-search-empty", shown === 0 && query !== "");
      if (shown === 0) {
        const copy = emptyCopy(query, filter);
        emptyReset = copy.resets;
        if (emptyMessage) emptyMessage.textContent = copy.message;
        if (emptyButton) emptyButton.textContent = copy.action;
      }
    }
    writeUrl(query, filter, sort);
    requestAnimationFrame(markTruncated);
  }

  /** What the address asked for when the page opened: Back from a result, or a shared link. */
  const params = new URLSearchParams(location.search);
  const startQuery = params.get("q");
  const startFilter = allowed(params.get("show"), LIBRARY_FILTERS);
  const startSort = allowed(params.get("sort"), LIBRARY_SORTS);
  if (input && startQuery) input.value = startQuery;
  for (const chip of chips) chip.checked = chip.value === startFilter;
  if (select && startSort) select.value = startSort;
  if (startQuery) loadFullText();

  /** How the last press was made: a touch must not raise the keyboard over the list it restored. */
  let lastPointer = "";
  root.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = event.pointerType;
    },
    { capture: true },
  );
  root.addEventListener("keydown", () => {
    lastPointer = "";
  });

  input?.addEventListener("focus", loadFullText);
  input?.addEventListener("input", () => {
    loadFullText();
    apply();
  });
  select?.addEventListener("change", apply);
  // Single-select: the chip just ticked is the filter, so the others untick.
  for (const chip of chips) {
    chip.addEventListener("change", () => {
      const chosen = chipFilter([], { value: chip.value, checked: chip.checked });
      for (const other of chips) other.checked = other.value === chosen;
      apply();
    });
  }
  clearText?.addEventListener("click", () => {
    if (input) input.value = "";
    apply();
    // The field's own X: the next thing is a new query, so the field keeps the focus.
    input?.focus();
  });
  emptyButton?.addEventListener("click", () => {
    if (input) input.value = "";
    if (emptyReset === "everything") for (const chip of chips) chip.checked = false;
    apply();
    // The button hides with the empty state, so the focus moves on: to the field from a keyboard or
    // a mouse, and to the first card from a touch, where the field would raise the keyboard.
    if (lastPointer === "touch" || lastPointer === "pen") {
      grid
        .querySelector<HTMLElement>("[data-card]:not([hidden]) .card-link")
        ?.focus({ preventScroll: true });
    } else input?.focus();
  });
  // A search field inside a form would reload the page on Enter. The keyboard's Search key also
  // puts the keyboard away, so the results it covered are in view.
  root.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    input?.blur();
  });
  /** Gallery or list, remembered on this device. Storage that fails leaves the gallery. */
  const viewButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-library-view]")];
  function showView(view: string): void {
    if (root) root.dataset.view = view;
    for (const button of viewButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.libraryView === view));
    }
    requestAnimationFrame(markTruncated);
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(VIEW_KEY);
  } catch {
    stored = null;
  }
  showView(stored === "list" ? "list" : "gallery");
  for (const button of viewButtons) {
    button.addEventListener("click", () => {
      const view = button.dataset.libraryView === "list" ? "list" : "gallery";
      showView(view);
      try {
        localStorage.setItem(VIEW_KEY, view);
      } catch {
        // Not remembered; it still works for this visit.
      }
    });
  }
  window.addEventListener("resize", () => requestAnimationFrame(markTruncated));
  // Turning a phone to landscape (40rem and up) offers the order again: apply what it holds. The
  // listener goes with the page, so visits do not pile up listeners on detached pages.
  const wide = matchMedia("(width < 40rem)");
  wide.addEventListener("change", apply);
  document.addEventListener("astro:before-swap", () => wide.removeEventListener("change", apply), {
    once: true,
  });

  // Episodes this device deleted may be taken out of the page after this script has counted it.
  // It goes with the page too: apply() writes the root, and an old visit's would hide the New
  // episode button on a later one.
  document.addEventListener("singularity:library-pruned", apply);
  document.addEventListener(
    "astro:before-swap",
    () => document.removeEventListener("singularity:library-pruned", apply),
    { once: true },
  );
  apply();
}

document.addEventListener("astro:page-load", install);

// The row menus' code (keys, Download, Share, the dialogs) is not the page's first load: it comes at
// idle, or at the first touch of a row's menu, whichever is first. A pick takes longer than that.
let menuLoaded = false;
function loadMenus(): void {
  if (menuLoaded) return;
  menuLoaded = true;
  void import("./libraryMenu").then((menu) => menu.installLibraryMenu());
}
whenIdle(loadMenus);
document.addEventListener("pointerdown", (event) => {
  if ((event.target as Element).closest?.("[data-library-menu]")) loadMenus();
});
document.addEventListener("focusin", (event) => {
  if ((event.target as Element).closest?.("[data-library-menu]")) loadMenus();
});
install();
