/**
 * The Library's search, sort and filter. The page is complete without this script: every briefing
 * is in the HTML, newest first. The script only hides, reorders and counts.
 */
import {
  type CardData,
  compareCards,
  emptyCopy,
  type LibraryFilter,
  type LibrarySort,
  matchDetail,
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
      metaLines: Number(element.dataset.metaLines ?? "0"),
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
  const emptyMessage = root.querySelector<HTMLElement>("[data-library-empty-message]");
  const emptyButton = root.querySelector<HTMLButtonElement>("[data-library-clear]");
  let emptyReset: "search" | "everything" = "search";
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
      const detail = passes ? matchDetail(card.data, query) : { meta: 0, stories: 0 };
      let matches = detail.meta + detail.stories;
      // A word that only the script or a story's text holds: the card is there, for another reason.
      const inText = passes && matches === 0 && textHasWords(fullText?.get(card.id) ?? "", query);
      if (inText) matches = 1;
      card.element.hidden = matches === 0;
      if (matches > 0) shown += 1;
      if (card.facts) {
        // While searching, the line under a card says why it is there, when a story is why. A card
        // found by its own date or title keeps its normal line: no story matched.
        const rest = card.facts.dataset.rest ?? "";
        const stories = detail.stories;
        let text = rest;
        if (searching && matches > 0) {
          if (inText) text = "Found in the full text";
          else if (stories === 1) text = "1 matching story";
          else if (stories > 1) text = `${stories} matching stories`;
        }
        if (card.facts.textContent !== text) card.facts.textContent = text;
      }
    }
    const ordered = [...cards].sort((a, b) => compareCards(a.data, b.data, sort));
    for (const card of ordered) grid?.append(card.element);
    if (status) status.textContent = resultSummary(shown, cards.length);
    if (empty) {
      empty.hidden = shown > 0;
      if (shown === 0) {
        const copy = emptyCopy(query, filter);
        emptyReset = copy.resets;
        if (emptyMessage) emptyMessage.textContent = copy.message;
        if (emptyButton) emptyButton.textContent = copy.action;
      }
    }
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
  emptyButton?.addEventListener("click", () => {
    if (input) input.value = "";
    if (filterSelect && emptyReset === "everything") filterSelect.value = "all";
    apply();
    input?.focus();
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

  /**
   * A half-heard item shows a thin bar along its cover. The player keeps the second it reached under
   * dispatch:resume:<id> (and forgets it once the item is finished), so the page reads that key and
   * loads no player code. The length is the card's own minutes: close enough for a bar.
   */
  function showProgress(): void {
    for (const card of cards) {
      const bar = card.element.querySelector<HTMLElement>("[data-cover-progress]");
      if (!bar) continue;
      let seconds = 0;
      try {
        seconds = Number(localStorage.getItem(`dispatch:resume:${card.id}`));
      } catch {
        seconds = 0;
      }
      const total = card.data.minutes * 60;
      const share = Number.isFinite(seconds) && total > 0 ? Math.min(seconds / total, 1) : 0;
      bar.hidden = share <= 0;
      if (share > 0) bar.style.setProperty("--progress", `${Math.round(share * 100)}%`);
    }
  }
  showProgress();
  window.addEventListener("pageshow", showProgress);
  apply();
}

document.addEventListener("astro:page-load", install);
install();
