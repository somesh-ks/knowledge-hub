/**
 * The segmented navigation's behaviour (primitives.css, .segmented-nav): a tablist whose tabs a press
 * or Left, Right, Home and End choose. The chosen tab is aria-selected and the only one in the Tab
 * order. `onSelect` hears the chosen tab's value (data-value) after the tabs show it.
 */

/** Marks `value`'s tab as the chosen one, without telling anyone: a view read from the address. */
export function selectTab(list: HTMLElement, value: string): void {
  for (const tab of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const on = tab.dataset.value === value;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
}

export function mountSegmentedNav(list: HTMLElement, onSelect: (value: string) => void): void {
  const tabs = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const choose = (tab: HTMLElement): void => {
    if (tab.getAttribute("aria-selected") === "true") return;
    selectTab(list, tab.dataset.value ?? "");
    onSelect(tab.dataset.value ?? "");
  };
  list.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"]');
    if (tab && list.contains(tab)) choose(tab);
  });
  list.addEventListener("keydown", (event) => {
    const all = tabs();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      Home: 0,
      End: all.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = all[(next + all.length) % all.length];
    if (!tab) return;
    tab.focus();
    // A click, so the tab sounds as a press does (uiSound.ts) and choose() runs once.
    tab.click();
  });
}
