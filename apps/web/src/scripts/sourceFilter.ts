/**
 * Search, and on a category's page format tabs (All, then one per format), over the source rows of the Categories & Sources index
 * (every source) or a topic's page (its own). Loaded by topicsPage.ts after the page is ready; the
 * page is whole HTML without it. The state lives in the address (?q=&format=a&format=b), written with
 * replaceState so a reload, or Back to the page, finds it as it was.
 */
import {
  type FilterRow,
  type FilterState,
  fold,
  isIdle,
  passes,
  readFilter,
  writeFilter,
} from "../lib/sourceFilter";

interface Entry {
  el: HTMLElement;
  row: FilterRow;
}

export function mountFilter(root: HTMLElement): void {
  const filter = root.querySelector<HTMLElement>("[data-filter]");
  if (!filter || filter.dataset.mounted !== undefined) return;
  filter.dataset.mounted = "";
  const field = filter.querySelector<HTMLInputElement>("[data-filter-q]");
  const none = filter.querySelector<HTMLElement>("[data-filter-none]");
  const clearText = filter.querySelector<HTMLButtonElement>("[data-filter-clear-text]");
  const tabs = [...filter.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  // The index swaps its topic list for the flat list of sources while a search is set.
  const library = root.querySelector<HTMLElement>("[data-library]");
  const topicLists = [...root.querySelectorAll<HTMLElement>(".topics-index, .topics-more")];
  const list = library ?? root.querySelector<HTMLElement>("ul[data-sources]:not([data-added])");
  const more = root.querySelector<HTMLButtonElement>("[data-show-all]");
  if (!field || !list) return;
  let expanded = list.hasAttribute("data-all");
  let wasIdle = true;

  const entries: Entry[] = [...list.querySelectorAll<HTMLElement>("li.source-row")].map((el) => ({
    el,
    row: {
      text: el.dataset.text ?? fold(el.textContent ?? ""),
      format: el.dataset.format ?? "",
    },
  }));

  const state: FilterState = readFilter(location.search);
  // A format with no tab here (an old address, or the index) narrows nothing; one tab is chosen at a time.
  state.formats = state.formats
    .filter((format) => tabs.some((tab) => tab.dataset.tab === format))
    .slice(0, 1);
  field.value = state.q;

  const apply = (): void => {
    const idle = isIdle(state);
    let shown = 0;
    for (const { el, row } of entries) {
      const ok = passes(row, state);
      el.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const tab of tabs) {
      const chosen = (tab.dataset.tab ?? "") === (state.formats[0] ?? "");
      tab.setAttribute("aria-selected", String(chosen));
      tab.tabIndex = chosen ? 0 : -1;
    }
    if (clearText) clearText.hidden = state.q === "";
    // The index shows its topics until something narrows the list; a topic's page lifts its fold.
    if (library) {
      library.hidden = idle;
      for (const topics of topicLists) topics.hidden = !idle;
    } else {
      // Remember a "Show more" the owner pressed before filtering, so clearing keeps it open.
      if (wasIdle && !idle) expanded = list.hasAttribute("data-all");
      list.toggleAttribute("data-all", !idle || expanded);
      if (more) more.hidden = !idle || expanded;
      wasIdle = idle;
    }
    if (none) none.hidden = idle || shown > 0;
    // The topic page's view (?view=preferences) is not the filter's, and stays.
    const params = new URLSearchParams(writeFilter(state));
    const view = new URLSearchParams(location.search).get("view");
    if (view) params.set("view", view);
    const search = params.toString();
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`,
    );
  };

  field.addEventListener("input", () => {
    state.q = field.value;
    apply();
  });
  // Enter in the field only searches; it must not submit a form around it.
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
  filter.addEventListener("click", (event) => {
    const target = (event.target as Element).closest("button");
    if (!target) return;
    if ("filterClearText" in target.dataset) {
      state.q = "";
      field.value = "";
      apply();
      field.focus();
      return;
    }
    if ("filterClear" in target.dataset) {
      state.q = "";
      state.formats = [];
      field.value = "";
      apply();
      field.focus();
      return;
    }
  });
  const choose = (tab: HTMLButtonElement): void => {
    state.formats = tab.dataset.tab ? [tab.dataset.tab] : [];
    apply();
  };
  filter.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>("[data-tab]");
    if (tab) choose(tab);
  });
  // A tablist's arrows, Home and End move the choice, as the page's view switch does.
  filter.addEventListener("keydown", (event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>("[data-tab]");
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const at = tab ? tabs.indexOf(tab) : -1;
    const to =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs[tabs.length - 1]
          : step && at >= 0
            ? tabs[(at + step + tabs.length) % tabs.length]
            : undefined;
    if (!to || at < 0) return;
    event.preventDefault();
    choose(to);
    to.focus();
  });
  apply();
}
