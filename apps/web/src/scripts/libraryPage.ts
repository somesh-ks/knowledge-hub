/**
 * The Library's search, sort and filter. The page is complete without this script: every briefing
 * is in the HTML, newest first. The script only hides, reorders and counts.
 */
import {
  type CardData,
  chipFilter,
  compareCards,
  EPISODE_KIND,
  emptyCopy,
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  type LibraryFilter,
  type LibrarySort,
  matchDetail,
  matchExcerpt,
  matchesFilter,
  moreMatches,
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
  const root = document.querySelector<HTMLElement>("#main [data-library]");
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
  }

  function apply(): void {
    const query = input?.value ?? "";
    const searching = query.trim() !== "";
    if (clearText) clearText.hidden = query === "";
    const sort = (select?.value ?? "newest") as LibrarySort;
    const filter = chipFilter(chips.filter((chip) => chip.checked).map((chip) => chip.value));
    // A narrowed order says so on its control, as a chosen chip does.
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

  /**
   * A half-heard item shows a thin bar under its cover, and a finished one says "Played". The player
   * keeps the second it reached under dispatch:resume:<id>, and once the item is finished forgets it
   * and writes dispatch:played:<id> instead, so the page reads those keys and loads no player code.
   * The length is the card's own minutes: close enough for a bar.
   */
  function showProgress(): void {
    for (const card of cards) {
      const bar = card.element.querySelector<HTMLElement>("[data-cover-progress]");
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
      // Heard to the end: "Played" takes the length's place in the facts line, so it never wraps
      // onto a line of its own and the kind or format stays. Half-heard, the bar says it.
      if (card.facts) {
        const finished = played && share <= 0;
        const length = card.facts.querySelector<HTMLElement>("[data-card-length]");
        if (length && finished !== card.facts.hasAttribute("data-played")) {
          length.dataset.minutes ??= length.textContent ?? "";
          card.facts.toggleAttribute("data-played", finished);
          length.textContent = finished
            ? (card.facts.dataset.playedLabel ?? "Played")
            : length.dataset.minutes;
        }
      }
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
