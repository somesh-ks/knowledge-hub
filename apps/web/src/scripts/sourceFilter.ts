/**
 * Search, and on a topic's page format tabs, over the source rows of the Topics & Sources index
 * (every source) or a topic's page (its own). Loaded by topicsPage.ts after the page is ready; the
 * page is whole HTML without it. The state lives in the address (?q=&format=), written with
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
  // A format with no tab here (an old address, or the index) narrows nothing.
  if (!tabs.some((tab) => tab.dataset.tab === state.format)) state.format = "";
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
      const chosen = tab.dataset.tab === state.format;
      tab.setAttribute("aria-selected", String(chosen));
      tab.tabIndex = chosen ? 0 : -1;
    }
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
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${writeFilter(state)}${location.hash}`,
    );
  };

  const choose = (tab: HTMLButtonElement): void => {
    state.format = tab.dataset.tab ?? "";
    apply();
    tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  field.addEventListener("input", () => {
    state.q = field.value;
    apply();
  });
  // Enter in the field only searches; it must not submit a form around it.
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });
  // The tabs are one stop: the arrows, Home and End move between them, as a tab list does.
  filter.addEventListener("keydown", (event) => {
    const at = tabs.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    const to =
      event.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    const next = tabs[to];
    if (!next) return;
    event.preventDefault();
    choose(next);
    next.focus();
  });
  filter.addEventListener("click", (event) => {
    const target = (event.target as Element).closest("button");
    if (!target) return;
    if ("filterClear" in target.dataset) {
      state.q = "";
      state.format = "";
      field.value = "";
      apply();
      field.focus();
      return;
    }
    if ("tab" in target.dataset) choose(target as HTMLButtonElement);
  });
  apply();
}
