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

interface Card {
  id: string;
  element: HTMLElement;
  facts: HTMLElement | null;
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
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-library-filter]")];
  if (!grid) return;
  const cards = [...grid.querySelectorAll<HTMLElement>("[data-card]")].map(readCard);

  let filter: LibraryFilter = "all";
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

  function apply(): void {
    const query = input?.value ?? "";
    const searching = query.trim() !== "";
    if (clearText) clearText.hidden = query === "";
    const sort = (select?.value ?? "newest") as LibrarySort;
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
        // While searching, the line under a card says why it is there.
        const rest = card.facts.dataset.rest ?? "";
        const text =
          searching && matches > 0
            ? inText
              ? "Found in the full text"
              : matches === 1
                ? "1 matching story"
                : `${matches} matching stories`
            : rest;
        if (card.facts.textContent !== text) card.facts.textContent = text;
      }
    }
    const ordered = [...cards].sort((a, b) => compareCards(a.data, b.data, sort));
    for (const card of ordered) grid?.append(card.element);
    if (status) status.textContent = resultSummary(shown, cards.length);
    if (empty) empty.hidden = shown > 0;
  }

  input?.addEventListener("focus", loadFullText);
  input?.addEventListener("input", () => {
    loadFullText();
    apply();
  });
  select?.addEventListener("change", apply);
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      filter = (chip.dataset.libraryFilter ?? "all") as LibraryFilter;
      for (const other of chips) other.setAttribute("aria-pressed", String(other === chip));
      apply();
    });
  }
  clearText?.addEventListener("click", () => {
    if (input) input.value = "";
    apply();
    input?.focus();
  });
  root.querySelector("[data-library-clear]")?.addEventListener("click", () => {
    if (input) input.value = "";
    filter = "all";
    for (const chip of chips) {
      chip.setAttribute("aria-pressed", String(chip.dataset.libraryFilter === "all"));
    }
    apply();
    input?.focus();
  });
  // A search field inside a form would reload the page on Enter.
  root.querySelector("form")?.addEventListener("submit", (event) => event.preventDefault());
  apply();
}

document.addEventListener("astro:page-load", install);
install();
