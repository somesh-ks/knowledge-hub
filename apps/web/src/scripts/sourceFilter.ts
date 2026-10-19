/**
 * Search and filter chips over the source rows of the Topics & Sources index (every source) or a
 * topic's page (its own). Loaded by topicsPage.ts after the page is ready; the page is whole HTML
 * without it. The state lives in the address (?q=&format=&status=), written with replaceState so
 * a reload, or Back to the page, finds it as it was.
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
  const chips = [...filter.querySelectorAll<HTMLButtonElement>("[data-chip]")];
  // The index swaps its topic list for the flat list of sources while a filter is set.
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
      statuses: (el.dataset.statuses ?? "").split(" ").filter(Boolean),
    },
  }));

  const state: FilterState = readFilter(location.search);
  field.value = state.q;

  const apply = (): void => {
    const idle = isIdle(state);
    let shown = 0;
    for (const { el, row } of entries) {
      const ok = passes(row, state);
      el.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const chip of chips) {
      const group = chip.dataset.chip === "format" ? "format" : "status";
      const value = chip.dataset.value ?? "";
      const pressed = (group === "format" ? state.formats : state.statuses).includes(value);
      const count = entries.filter(
        ({ row }) =>
          passes(row, state, group) &&
          (group === "format" ? row.format === value : row.statuses.includes(value)),
      ).length;
      chip.setAttribute("aria-pressed", String(pressed));
      chip.disabled = count === 0 && !pressed;
      const number = chip.querySelector("[data-count]");
      if (number) number.textContent = String(count);
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
    if ("filterClear" in target.dataset) {
      state.q = "";
      state.formats = [];
      state.statuses = [];
      field.value = "";
      apply();
      field.focus();
      return;
    }
    if (!("chip" in target.dataset)) return;
    const group = target.dataset.chip === "format" ? state.formats : state.statuses;
    const value = target.dataset.value ?? "";
    const at = group.indexOf(value);
    if (at >= 0) group.splice(at, 1);
    else group.push(value);
    apply();
  });
  apply();
}
