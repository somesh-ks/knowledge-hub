/**
 * The segmented navigation's behaviour (primitives.css, .segmented-nav): a tablist whose tabs a press
 * or Left, Right, Home and End choose. The chosen tab is aria-selected and the only one in the Tab
 * order. `onSelect` hears the chosen tab's data-value after the tabs show it. Kept small: the topic
 * pages load it first.
 */

const TAB = '[role="tab"]';

/** Marks `value`'s tab as the chosen one, without telling anyone: a view read from the address. */
export function selectTab(list: HTMLElement, value: string): void {
  for (const tab of list.querySelectorAll<HTMLElement>(TAB)) {
    const on = tab.dataset.value === value;
    tab.ariaSelected = String(on);
    tab.tabIndex = on ? 0 : -1;
  }
}

export function mountSegmentedNav(list: HTMLElement, onSelect: (value: string) => void): void {
  list.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>(TAB);
    if (!tab || tab.ariaSelected === "true") return;
    const value = tab.dataset.value ?? "";
    selectTab(list, value);
    onSelect(value);
    // A list with data-param keeps its choice in the address (the first tab is the default), so a
    // reload or Back finds it; the address's other parameters stay.
    const param = list.dataset.param;
    if (param) {
      const url = new URL(location.href);
      if (tab === list.querySelector(TAB)) url.searchParams.delete(param);
      else url.searchParams.set(param, value);
      history.replaceState(history.state, "", url);
    }
  });
  list.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll<HTMLElement>(TAB)];
    const at = tabs.indexOf(event.target as HTMLElement);
    const n = tabs.length;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n - 1 }[event.key];
    if (at < 0 || to === undefined) return;
    event.preventDefault();
    // A click, so the tab sounds as a press does (uiSound.ts) and the choice runs once.
    const tab = tabs[(to + n) % n];
    tab?.focus();
    tab?.click();
  });
}
