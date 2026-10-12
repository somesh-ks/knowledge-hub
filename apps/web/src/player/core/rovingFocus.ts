/**
 * A roving tabindex for a long list of buttons (the transcript's turns, the chapter rows), as
 * Material's list does: the whole list is one Tab stop, Up and Down move between its items, Home
 * and End jump to the ends, and Enter or Space press the focused one as a button always does.
 */

/** Where a key moves focus from `index` in a list of `count` items, or null when it does not. */
export function rovingStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, index + 1);
    case "ArrowUp":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Which item holds the list's one Tab stop: the focused one while focus is inside the list, else
 * the current one (the turn being spoken, the story being read), else the one focused last, else
 * the first.
 */
export function rovingStop(
  count: number,
  focused: number,
  current: number,
  lastFocused: number,
): number {
  if (count <= 0) return -1;
  const valid = (index: number): boolean => index >= 0 && index < count;
  if (valid(focused)) return focused;
  if (valid(current)) return current;
  if (valid(lastFocused)) return lastFocused;
  return 0;
}

export interface RovingList {
  /** Gives the Tab stop to the right item; call after every render of the list. */
  sync(): void;
  dispose(): void;
}

/** Wires a roving tabindex onto `root` for the items `selector` matches inside it. */
export function installRovingFocus(root: HTMLElement, selector: string): RovingList {
  let last: HTMLElement | null = null;
  const items = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));
  const sync = (): void => {
    const list = items();
    const active = document.activeElement;
    const focused = list.indexOf(active as HTMLElement);
    const current = list.findIndex((item) => item.getAttribute("aria-current") === "true");
    const stop = rovingStop(list.length, focused, current, last ? list.indexOf(last) : -1);
    list.forEach((item, index) => {
      item.tabIndex = index === stop ? 0 : -1;
    });
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const list = items();
    const from = list.findIndex((item) => item.contains(event.target as Node));
    if (from < 0) return;
    const to = rovingStep(event.key, from, list.length);
    if (to === null) return;
    event.preventDefault();
    list[to]?.focus();
  };
  const onFocusIn = (event: FocusEvent): void => {
    const item = items().find((candidate) => candidate === event.target);
    if (!item) return;
    last = item;
    sync();
  };
  const onFocusOut = (): void => {
    // Once focus has left, the stop goes back to the current item for the next visit.
    queueMicrotask(() => {
      if (!root.contains(document.activeElement)) sync();
    });
  };
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  sync();
  return {
    sync,
    dispose() {
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
    },
  };
}
