/**
 * The Library's search, sort and filter. The page is complete without this script: every briefing
 * is in the HTML, newest first. The script only hides, reorders and counts.
 */
import {
  type CardData,
  compareCards,
  type LibraryFilter,
  type LibrarySort,
  matchCount,
  matchesFilter,
  resultSummary,
  type SearchIndexEntry,
  textHasWords,
} from "../lib/library";

const VIEW_KEY = "dispatch:library-view";

interface Card {
  id: string;
  element: HTMLElement;
  facts: HTMLElement | null;
  /** "Weekly, " before the facts, on a weekly briefing's card only. */
  kind: HTMLElement | null;
  data: CardData;
}

function readCard(element: HTMLElement, order: number): Card {
  const {
    id = "",
    date = "",
    kind = "",
    stories = "0",
    minutes = "0",
    search = "",
  } = element.dataset;
  return {
    id,
    element,
    facts: element.querySelector<HTMLElement>("[data-card-facts]"),
    kind: element.querySelector<HTMLElement>("[data-card-kind]"),
    data: {
      date,
      order,
      kind,
      stories: Number(stories),
      minutes: Number(minutes),
      hasAudio: element.dataset.audio !== undefined,
      search,
    },
  };
}

function install(): void {
  const root = document.querySelector<HTMLElement>("[data-library]");
  if (!root || root.dataset.ready !== undefined) return;
  root.dataset.ready = "";

  const grid = root.querySelector<HTMLElement>("[data-library-grid]");
  const input = root.querySelector<HTMLInputElement>("[data-library-search]");
  const select = root.querySelector<HTMLSelectElement>("[data-library-sort]");
  const status = root.querySelector<HTMLElement>("[data-library-status]");
  const empty = root.querySelector<HTMLElement>("[data-library-empty]");
  const clearText = root.querySelector<HTMLButtonElement>("[data-library-clear-text]");
  const filterSelect = root.querySelector<HTMLSelectElement>("[data-library-filter]");
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>("[data-card]")].map(readCard);

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

  function apply(): void {
    const query = input?.value ?? "";
    const searching = query.trim() !== "";
    if (clearText) clearText.hidden = query === "";
    const sort = (select?.value ?? "newest") as LibrarySort;
    const filter = (filterSelect?.value || "all") as LibraryFilter;
    let shown = 0;
    for (const card of cards) {
      const passes = matchesFilter(card.data, filter);
      let matches = passes ? matchCount(card.data, query) : 0;
      // A word that only the script or a story's text holds: the card is there, for another reason.
      const inText = passes && matches === 0 && textHasWords(fullText?.get(card.id) ?? "", query);
      if (inText) matches = 1;
      card.element.hidden = matches === 0;
      if (matches > 0) shown += 1;
      if (card.facts) {
        // While searching, the line under a card says why it is there, and that alone.
        const rest = card.facts.dataset.rest ?? "";
        const found = searching && matches > 0;
        const text = found
          ? inText
            ? "Found in the full text"
            : matches === 1
              ? "1 matching story"
              : `${matches} matching stories`
          : rest;
        if (card.facts.textContent !== text) card.facts.textContent = text;
        if (card.kind && card.kind.hidden !== found) card.kind.hidden = found;
      }
    }
    const ordered = [...cards].sort((a, b) => compareCards(a.data, b.data, sort));
    for (const card of ordered) grid?.append(card.element);
    if (status) status.textContent = resultSummary(shown, cards.length);
    if (empty) empty.hidden = shown > 0;
    requestAnimationFrame(markTruncated);
  }

  input?.addEventListener("focus", loadFullText);
  input?.addEventListener("input", () => {
    loadFullText();
    apply();
  });
  select?.addEventListener("change", apply);
  filterSelect?.addEventListener("change", apply);
  clearText?.addEventListener("click", () => {
    if (input) input.value = "";
    apply();
    input?.focus();
  });
  root.querySelector("[data-library-clear]")?.addEventListener("click", () => {
    if (input) input.value = "";
    if (filterSelect) filterSelect.value = "all";
    apply();
    input?.focus();
  });
  // A search field inside a form would reload the page on Enter.
  root.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
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
  apply();
}

document.addEventListener("astro:page-load", install);
install();
