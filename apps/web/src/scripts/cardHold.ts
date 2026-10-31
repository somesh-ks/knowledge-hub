/**
 * A Library card's menu by long press on a touch screen (D264). The ⋮ is still in the page for a
 * keyboard and a screen reader (library.css hides it from a finger only), and this opens the same
 * popover from a hold on the card. A tap still opens the card; a scroll, or a finger that drifts
 * past the slop, cancels the hold (the browser sends pointercancel when a scroll takes the touch).
 */
import { MENU_SELECTORS } from "../design-system/menu";

/** Matches the CSS that hides the button (library.css): a finger is the primary input. */
const TOUCH = "(hover: none) and (pointer: coarse)";
const HOLD_MS = 450;
/** How far a finger may drift and still be holding, in CSS px. */
const SLOP = 10;

let installed = false;

export function installCardHold(): void {
  if (installed) return;
  installed = true;

  let timer = 0;
  let start: { x: number; y: number; id: number } | null = null;
  /** True from a hold's firing until its finger lifts. */
  let held = false;

  const cancel = (): void => {
    clearTimeout(timer);
    start = null;
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      cancel();
      held = false;
      if (event.pointerType !== "touch" || !event.isPrimary || !matchMedia(TOUCH).matches) return;
      const link = (event.target as Element).closest<HTMLElement>(".card-link");
      const list = link
        ?.closest("[data-card]")
        ?.querySelector<HTMLElement>(`[data-library-menu] ${MENU_SELECTORS.list}`);
      if (!link || !list) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      const pointerId = event.pointerId;
      timer = window.setTimeout(() => {
        start = null;
        if (list.matches(":popover-open")) return;
        // As after a tap on the button: focus is on it first, so the sheet's first row, which the menu
        // focuses on open, takes no keyboard ring. Its own ring is the keyboard's (library.css).
        list.parentElement
          ?.querySelector<HTMLElement>("[data-hero-more]")
          ?.focus({ preventScroll: true });
        list.showPopover();
        held = true;
        // The finger is still down on the card. Lifted over it, it would light-dismiss the sheet the
        // moment it opened (the press began outside any popover). Held by the sheet, the lift ends
        // in the sheet and it stays open.
        try {
          list.setPointerCapture(pointerId);
        } catch {
          // The touch already ended: nothing to hold.
        }
      }, HOLD_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!start || event.pointerId !== start.id) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP) cancel();
    },
    { passive: true },
  );
  for (const type of ["pointerup", "pointercancel"]) {
    document.addEventListener(type, cancel, { passive: true });
  }
  // The lift of a hold is not a tap. The browser would follow it with mouse events: the press focuses
  // the card's link, which takes focus from the sheet (heroMenu.ts closes a menu that loses it),
  // and the click opens the card under the sheet.
  document.addEventListener("touchend", (event) => {
    if (!held) return;
    held = false;
    event.preventDefault();
  });

  // Android reads a hold on a link as its link menu, and iOS and Android as a drag of it: the card
  // has its own menu now. A mouse's right click keeps the browser's (copy link).
  document.addEventListener("contextmenu", (event) => {
    if (!matchMedia(TOUCH).matches) return;
    if ((event.target as Element).closest?.("[data-card] .card-link")) event.preventDefault();
  });
}
