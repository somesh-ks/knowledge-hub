/**
 * The Reorderable list: a list whose rows the listener moves by dragging. Draw the list and its rows
 * with reorderListClass() and reorderItemClass(); `attachReorder` adds the behaviour. The rules are in
 * styles/reorder.css; the style guide lists REORDER.
 *
 * One gesture on every input. A mouse presses on a row and pulls (the cursor is the 4-way move
 * arrow while it hovers a row). A finger holds for HOLD_MS (the card menu's hold, D264) and then
 * moves; before the hold a scroll is still a scroll, and the hold is dropped if the finger drifts.
 * A handle (reorderHandleClass(), the two bars at a row's end) lifts its row at once for any
 * pointer: it is for a finger that should not have to wait. A drag is never the only way: Alt and
 * the arrow keys move a focused row (the arrows alone on a focused handle), the caller's own menu
 * can too, and every move is announced.
 */
import type { Guidance } from "./guidance";

export const REORDER: Guidance = {
  summary: "Rows the listener moves by dragging.",
  useWhen: ["The order is theirs to set, as a queue's."],
  dontUseWhen: [{ when: "The app computes the order." }],
};

/** Every class the Reorderable list draws, for the registry and its test. */
export const REORDER_CLASSES: string[] = ["reorder-list", "reorder-item", "reorder-handle"];

/** Classes the Reorderable list replaced; none may be written again, in any app that draws the system. */
export const REORDER_RETIRED: string[] = [];

export const reorderListClass = (): string => "reorder-list";
export const reorderItemClass = (): string => "reorder-item";
/** A control inside a row that lifts it at once; draw the two bars (grip) in it, label it for the row. */
export const reorderHandleClass = (): string => "reorder-handle";

/** How long a finger holds before the row lifts: the Library card menu's hold (D264). */
export const HOLD_MS = 450;
/** How far a pointer may drift, in CSS px, and still be holding or tapping. */
export const SLOP_PX = 10;
/** How near a scroller's edge the pointer is when the list starts to scroll under it, in CSS px. */
const EDGE_PX = 48;
/** The most the list scrolls in one frame, in CSS px. */
const SCROLL_STEP_PX = 14;
/** The selector of reorderHandleClass(). */
const HANDLE = ".reorder-handle";
/** How long after a drag the row's own click is not a press, in ms. */
const CLICK_QUIET_MS = 400;

/**
 * Where a dragged row lands: the number of the other rows whose middle is above `y`. `mids` holds
 * every row's middle, in order, in the list's own coordinates; `from` is the dragged row.
 */
export function slotAt(y: number, mids: readonly number[], from: number): number {
  let slot = 0;
  mids.forEach((mid, index) => {
    if (index !== from && mid < y) slot += 1;
  });
  return slot;
}

export interface ReorderOptions {
  /** Called once when a drag ends where it began and a move is wanted, with the row's old and new place. */
  onMove(from: number, to: number): void;
  /** Says a change in words for a screen reader. */
  announce?(message: string): void;
  /** What a row is called, for those words. */
  label?(item: HTMLElement): string;
  /** A selector for controls inside a row that have presses of their own (a menu's dots). A handle needs no entry. */
  ignore?: string;
  /** Where focus goes after a keyboard move; the row's first button when absent. */
  focusAfterMove?(item: HTMLElement): void;
  /** Called as a row lifts: a haptic tick goes here. */
  onPickup?(): void;
  holdMs?: number;
}

interface Press {
  pointerId: number;
  pointerType: string;
  item: HTMLElement;
  index: number;
  x0: number;
  y0: number;
  timer: number;
  lifted: boolean;
}

/** The row's own gesture surface, found where the list's rows are its direct children. */
function itemsOf(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.matches(".reorder-item"),
  );
}

/** The nearest ancestor that scrolls, or the page. */
function scrollerOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight)
      return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Adds dragging and Alt+arrow moves to `list`. Returns what takes it off again. */
export function attachReorder(list: HTMLElement, options: ReorderOptions): () => void {
  const holdMs = options.holdMs ?? HOLD_MS;
  let press: Press | null = null;
  let quietUntil = 0;
  // The lifted row's state while it is held.
  let rows: HTMLElement[] = [];
  let mids: number[] = [];
  let startListY = 0;
  let target = 0;
  let lastClientY = 0;
  let step = 0;
  let scroller: HTMLElement | null = null;
  let frame = 0;

  const labelOf = (item: HTMLElement): string => options.label?.(item) ?? "Item";
  const say = (message: string): void => options.announce?.(message);
  const listY = (clientY: number): number => clientY - list.getBoundingClientRect().top;
  // Once a finger has lifted a row the page must not scroll under it: a touchmove that is not
  // passive can say so, and only until the hold has fired (a scroll that began cannot be stopped).
  const stopScroll = (event: TouchEvent): void => {
    if (event.cancelable) event.preventDefault();
  };

  function shift(): void {
    if (!press?.lifted) return;
    const from = press.index;
    target = slotAt(listY(lastClientY), mids, from);
    rows.forEach((row, index) => {
      if (index === from) return;
      let by = 0;
      if (from < target && index > from && index <= target) by = -step;
      else if (from > target && index >= target && index < from) by = step;
      row.style.translate = by ? `0 ${by}px` : "";
    });
    press.item.style.translate = `0 ${listY(lastClientY) - startListY}px`;
  }

  function autoScroll(): void {
    frame = 0;
    if (!press?.lifted || !scroller) return;
    const box =
      scroller === document.scrollingElement || scroller === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect();
    let delta = 0;
    if (lastClientY < box.top + EDGE_PX) delta = -SCROLL_STEP_PX;
    else if (lastClientY > box.bottom - EDGE_PX) delta = SCROLL_STEP_PX;
    if (delta) {
      scroller.scrollTop += delta;
      shift();
    }
    frame = requestAnimationFrame(autoScroll);
  }

  function lift(): void {
    const current = press;
    if (!current || current.lifted) return;
    clearTimeout(current.timer);
    current.lifted = true;
    rows = itemsOf(list);
    mids = rows.map((row) => row.offsetTop + row.offsetHeight / 2);
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    step = current.item.offsetHeight + gap;
    startListY = listY(current.y0);
    target = current.index;
    scroller = scrollerOf(list);
    try {
      current.item.setPointerCapture(current.pointerId);
    } catch {
      // A pointer that is already gone has nothing to capture.
    }
    list.dataset.reordering = "";
    current.item.dataset.lifted = "";
    document.addEventListener("touchmove", stopScroll, { passive: false });
    options.onPickup?.();
    say(`${labelOf(current.item)}, picked up. Position ${current.index + 1} of ${rows.length}.`);
    frame = requestAnimationFrame(autoScroll);
  }

  function finish(commit: boolean): void {
    const current = press;
    press = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (!current.lifted) return;
    cancelAnimationFrame(frame);
    document.removeEventListener("touchmove", stopScroll);
    quietUntil = performance.now() + CLICK_QUIET_MS;
    for (const row of rows) row.style.translate = "";
    delete current.item.dataset.lifted;
    delete list.dataset.reordering;
    const to = target;
    if (commit && to !== current.index) {
      options.onMove(current.index, to);
      say(`${labelOf(current.item)}, dropped. Position ${to + 1} of ${rows.length}.`);
    } else say(`${labelOf(current.item)}, dropped where it was.`);
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target as Element;
    if (options.ignore && target.closest(options.ignore)) return;
    const onHandle = target.closest(HANDLE) !== null;
    const item = target.closest<HTMLElement>(".reorder-item");
    if (!item || item.parentElement !== list) return;
    finish(false);
    press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      item,
      index: itemsOf(list).indexOf(item),
      x0: event.clientX,
      y0: event.clientY,
      timer: 0,
      lifted: false,
    };
    lastClientY = event.clientY;
    // A handle lifts at once; otherwise a finger lifts a row by holding it and a mouse by pulling it (below).
    if (onHandle) lift();
    else if (event.pointerType !== "mouse") press.timer = window.setTimeout(lift, holdMs);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = press;
    if (!current || current.pointerId !== event.pointerId) return;
    lastClientY = event.clientY;
    if (!current.lifted) {
      const dx = event.clientX - current.x0;
      const dy = event.clientY - current.y0;
      if (current.pointerType === "mouse") {
        // Up and down is a move; sideways is the row's own swipe, which has marked it.
        if (
          Math.abs(dy) >= SLOP_PX &&
          Math.abs(dy) > Math.abs(dx) &&
          !current.item.hasAttribute("data-swiping")
        )
          lift();
      } else if (Math.hypot(dx, dy) > SLOP_PX) {
        // A finger that moved before the hold is scrolling or swiping, not holding.
        clearTimeout(current.timer);
        press = null;
      }
      if (!press?.lifted) return;
    }
    event.preventDefault();
    shift();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (press && press.pointerId === event.pointerId) finish(true);
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (press && press.pointerId === event.pointerId) finish(false);
  };
  // A press that lifted a row is not a tap on what is under it.
  const onClick = (event: MouseEvent): void => {
    if (performance.now() < quietUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  // A long press must not open the system's menu or callout over a held row.
  const onContextMenu = (event: Event): void => {
    if (press) event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const origin = event.target as HTMLElement;
    // On a handle the arrows alone move; elsewhere they are the page's, and Alt asks for the move.
    if (!(event.altKey || origin.closest(HANDLE))) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const item = origin.closest<HTMLElement>(".reorder-item");
    if (!item || item.parentElement !== list) return;
    const all = itemsOf(list);
    const from = all.indexOf(item);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    event.preventDefault();
    if (to < 0 || to >= all.length) return;
    options.onMove(from, to);
    say(`${labelOf(item)}, ${to + 1} of ${all.length}`);
    // The moved row keeps its element, but a moved node can lose focus: give it back.
    requestAnimationFrame(() => {
      if (options.focusAfterMove) options.focusAfterMove(item);
      else
        (item.contains(origin) ? origin : item.querySelector<HTMLElement>("button"))?.focus({
          preventScroll: true,
        });
    });
  };

  list.addEventListener("pointerdown", onPointerDown);
  list.addEventListener("pointermove", onPointerMove);
  list.addEventListener("pointerup", onPointerUp);
  list.addEventListener("pointercancel", onPointerCancel);
  list.addEventListener("click", onClick, true);
  list.addEventListener("contextmenu", onContextMenu);
  list.addEventListener("keydown", onKeyDown);
  return () => {
    finish(false);
    list.removeEventListener("pointerdown", onPointerDown);
    list.removeEventListener("pointermove", onPointerMove);
    list.removeEventListener("pointerup", onPointerUp);
    list.removeEventListener("pointercancel", onPointerCancel);
    list.removeEventListener("click", onClick, true);
    list.removeEventListener("contextmenu", onContextMenu);
    list.removeEventListener("keydown", onKeyDown);
  };
}
