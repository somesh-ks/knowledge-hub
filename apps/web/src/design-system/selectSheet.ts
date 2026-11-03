/**
 * The Select's list on a phone: the standard bottom sheet, the one a ⋮ menu opens, with the field's
 * label as its title, Close at the end and a row for each option (menu.css). A select keeps its
 * native list from 40rem, where it opens under the field; on a phone the browser's own list is
 * stopped and this opens instead (owner, 2026-10-31: one kind of bottom sheet everywhere). The
 * select stays in the page and holds the value: a choice sets it and fires its `input` and `change`,
 * so whatever listens for a select hears it as it always did. Loaded by Select.astro.
 *
 * This file is only the listener, on every page with a Select. The sheet itself is selectSheetView.ts,
 * fetched when the browser is idle or on the first open, whichever comes first (2026-11-03: the
 * sheet's code was about 20 KB of every page's first load). The browser's list is stopped here at
 * once, before anything is fetched, so it never shows while the sheet's code is on its way.
 */
import { warmWhenIdle } from "../scripts/idle";
import { installSheetTapGuard } from "../scripts/sheetTap";

type View = typeof import("./selectSheetView");

const PHONE = "(width < 40rem)";
/** How far a finger may travel and still be a tap, in px. */
const TAP_SLOP = 10;
const KEYS = new Set(["Enter", " ", "F4"]);

let installed = false;
let view: View | null = null;
let loading: Promise<View> | null = null;
/**
 * The sheet's code could not be fetched (offline before it arrived). Chromium fails every later import
 * of a module whose fetch failed (docs/learnings.md), so the selects keep the browser's own list until
 * the next page load.
 */
let unavailable = false;

/** The sheet's code, fetched once. */
function loadView(): Promise<View> {
  loading ??= import("./selectSheetView").then(
    (module) => {
      view = module;
      return module;
    },
    (error: unknown) => {
      unavailable = true;
      throw error;
    },
  );
  return loading;
}

/** A select this sheet stands in for: drawn by the Select, shown, enabled and single-valued. */
function sheetFor(target: EventTarget | null): HTMLSelectElement | null {
  const select = (target as Element | null)?.closest?.("select");
  if (!select || select.disabled || select.multiple) return null;
  if (unavailable && !select.hasAttribute("data-opens")) return null;
  if (!select.closest("[data-select]") || select.classList.contains("picker-native")) return null;
  // A select that names a panel (data-opens) opens it at any width, in place of its list.
  if (select.hasAttribute("data-opens")) return select;
  return matchMedia(PHONE).matches ? select : null;
}

function open(select: HTMLSelectElement, byKey: boolean): void {
  // A select that stands for a panel (Default playback speed) opens that popover, a Menu the page
  // drew, and keeps the value: the panel writes it back to the select.
  if (select.dataset.opens) {
    const panel = document.getElementById(select.dataset.opens);
    if (panel && !panel.matches(":popover-open")) {
      select.focus({ preventScroll: true });
      panel.showPopover();
    }
    return;
  }
  if (view) {
    view.openSheet(select, byKey);
    return;
  }
  // The first open before the idle fetch landed: the field holds focus while the code arrives, and the
  // sheet opens only if it still does (a reader who moved on is not handed a sheet seconds later). If
  // the code cannot arrive, the browser's own list opens instead, and every later tap gets it too.
  select.focus({ preventScroll: true });
  loadView().then(
    (module) => {
      if (document.activeElement === select) module.openSheet(select, byKey);
    },
    () => {
      try {
        if (document.activeElement === select) select.showPicker();
      } catch {
        // The tap's activation has lapsed: the next tap opens the browser's list itself.
      }
    },
  );
}

/** Stops the browser's own list on a phone and opens the sheet in its place. */
export function installSelectSheet(): void {
  if (installed) return;
  installed = true;
  // A tap beside the sheet closes it and reaches nothing under the finger (as for a menu's sheet).
  installSheetTapGuard();
  warmWhenIdle(loadView);

  // The browser opens a select on the press (a pointer) or on the tap that follows it (a finger).
  // A pointer's press is stopped here. A finger's tap is stopped at the touch's end, which also
  // withholds the click that would follow, so the sheet opens from it; a touch that moved is a scroll
  // and is left alone. A click that comes from neither (an assistive tool) opens the sheet too.
  let touchAt: { x: number; y: number } | null = null;
  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      touchAt = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const start = touchAt;
      touchAt = null;
      const touch = event.changedTouches[0];
      const select = sheetFor(event.target);
      if (!start || !touch || !select || !event.cancelable) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP) return;
      event.preventDefault();
      open(select, false);
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      if (sheetFor(event.target)) event.preventDefault();
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const select = sheetFor(event.target);
      if (!select) return;
      event.preventDefault();
      open(select, false);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const select = sheetFor(event.target);
      if (!select || !(KEYS.has(event.key) || (event.altKey && event.key === "ArrowDown"))) return;
      event.preventDefault();
      open(select, true);
    },
    true,
  );
}
