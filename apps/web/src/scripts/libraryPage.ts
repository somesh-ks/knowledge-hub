/**
 * The Library's search, sort and filter. The page is complete without this script: every briefing
 * is in the HTML, newest first. The script only hides, reorders and counts.
 */
import {
  type CardData,
  compareCards,
  emptyCopy,
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  type LibraryFilter,
  type LibrarySort,
  matchDetail,
  matchesFilter,
  normalize,
  resultSummary,
  type SearchIndexEntry,
  storyHeadline,
  textHasWords,
} from "../lib/library";

const VIEW_KEY = "dispatch:library-view";
/** Written by the player (player/core/resume.ts) when an item is heard to the end. */
const PLAYED_KEY_PREFIX = "dispatch:played:";

interface Card {
  id: string;
  element: HTMLElement;
  facts: HTMLElement | null;
  /** The card's search text as written, a line each: a matching story is named from it. */
  lines: string[];
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
    lines: search.split("\n"),
    data: {
      metaLines: Number(element.dataset.metaLines ?? "0"),
      date,
      order,
      kind,
      stories: Number(stories),
      minutes: Number(minutes),
      hasAudio: element.dataset.audio !== undefined,
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

  /**
   * The line under a card: its own facts, or while searching why it is there. A matching story is
   * named by its headline, cut to one line, with how many more matched after it.
   */
  function writeFacts(facts: HTMLElement, text: string, headline?: string, more = 0): void {
    const key = headline === undefined ? text : `${headline}\n${more}`;
    if (facts.dataset.shown === key) return;
    facts.dataset.shown = key;
    if (headline === undefined) {
      delete facts.dataset.match;
      facts.textContent = text;
      return;
    }
    facts.dataset.match = "";
    const name = document.createElement("span");
    name.className = "card-match";
    name.textContent = headline;
    facts.replaceChildren(name);
    if (more > 0) {
      const rest = document.createElement("span");
      rest.className = "card-match-more";
      rest.textContent = `+${more}`;
      rest.title = `${more} more matching ${more === 1 ? "story" : "stories"}`;
      facts.append(rest);
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
  }

  function apply(): void {
    const query = input?.value ?? "";
    const searching = query.trim() !== "";
    if (clearText) clearText.hidden = query === "";
    const sort = (select?.value ?? "newest") as LibrarySort;
    const filter = (filterSelect?.value || "all") as LibraryFilter;
    // A narrowed list says so on its controls, as a chosen chip does.
    filterSelect?.closest(".sort-field")?.toggleAttribute("data-active", filter !== "all");
    select?.closest(".sort-field")?.toggleAttribute("data-active", sort !== "newest");
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
      if (!card.facts) continue;
      // While searching, the line under a card says why it is there, when a story is why. A card
      // found by its own date or title keeps its normal line: no story matched.
      const rest = card.facts.dataset.rest ?? "";
      if (searching && inText) writeFacts(card.facts, "Mentioned in a story");
      else if (searching && matches > 0 && detail.stories > 0 && "first" in detail) {
        const headline = storyHeadline(card.lines[detail.first ?? 0] ?? "");
        writeFacts(card.facts, rest, headline, detail.stories - 1);
      } else writeFacts(card.facts, rest);
    }
    const ordered = [...live].sort((a, b) => compareCards(a.data, b.data, sort));
    for (const card of ordered) grid?.append(card.element);
    if (status) status.textContent = resultSummary(shown, live.length);
    if (empty) {
      empty.hidden = shown > 0;
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
  if (filterSelect && startFilter) filterSelect.value = startFilter;
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
  filterSelect?.addEventListener("change", apply);
  clearText?.addEventListener("click", () => {
    if (input) input.value = "";
    apply();
    // The field's own X: the next thing is a new query, so the field keeps the focus.
    input?.focus();
  });
  emptyButton?.addEventListener("click", () => {
    if (input) input.value = "";
    if (filterSelect && emptyReset === "everything") filterSelect.value = "all";
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

  /**
   * A half-heard item shows a thin bar under its cover, and a finished one says "Played". The player
   * keeps the second it reached under dispatch:resume:<id>, and once the item is finished forgets it
   * and writes dispatch:played:<id> instead, so the page reads those keys and loads no player code.
   * The length is the card's own minutes: close enough for a bar.
   */
  function showProgress(): void {
    for (const card of cards) {
      const bar = card.element.querySelector<HTMLElement>("[data-cover-progress]");
      const playedMark = card.element.querySelector<HTMLElement>("[data-card-played]");
      let seconds = 0;
      let played = false;
      try {
        seconds = Number(localStorage.getItem(`dispatch:resume:${card.id}`));
        played = localStorage.getItem(`${PLAYED_KEY_PREFIX}${card.id}`) !== null;
      } catch {
        seconds = 0;
      }
      const total = card.data.minutes * 60;
      const share = Number.isFinite(seconds) && total > 0 ? Math.min(seconds / total, 1) : 0;
      if (playedMark) playedMark.hidden = !played || share > 0;
      if (!bar) continue;
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
