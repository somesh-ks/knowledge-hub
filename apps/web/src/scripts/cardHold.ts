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

/**
 * How long after the lift a close is still the hold's own (ms). iPhone Safari closed the sheet at
 * the lift (2026-10-31, the owner's phone: "a flash, then it goes away") where the pointer capture
 * below holds it open in Chromium. The cause there is unverified, so the sheet is opened again once
 * for any close inside this window: nobody can pick or dismiss in it.
 */
const LIFT_GRACE_MS = 400;
/** A hold opens its sheet again this often, never in a loop. */
const MAX_REOPENS = 2;

/**
 * Set on a hold's sheet while the hold may still reopen it: the time (performance.now) the grace ends,
 * Infinity while the finger is down. The interface sound reads it so a close and a reopen the hold
 * makes itself are not heard as a sheet closing and opening again (uiClicks.ts).
 */
export const HOLD_UNTIL = "data-hold-until";

let installed = false;

export function installCardHold(): void {
  if (installed) return;
  installed = true;

  let timer = 0;
  let start: { x: number; y: number; id: number } | null = null;
  /** True from a hold's firing until its finger lifts. */
  let held = false;
  /** The sheet a hold opened, until its grace after the lift is over. */
  let opened: HTMLElement | null = null;
  let graceEnds = 0;
  let reopens = 0;

  /** The sheet is the person's again: its closes and opens are theirs to hear. */
  const release = (): void => {
    opened?.removeAttribute(HOLD_UNTIL);
    opened = null;
  };

  const cancel = (): void => {
    clearTimeout(timer);
    start = null;
    // The finger is up (or the browser took the touch): the grace runs from here.
    if (opened) {
      graceEnds = performance.now() + LIFT_GRACE_MS;
      opened.setAttribute(HOLD_UNTIL, String(graceEnds));
    }
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      cancel();
      held = false;
      release();
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
        opened = list;
        graceEnds = Number.POSITIVE_INFINITY;
        list.setAttribute(HOLD_UNTIL, String(graceEnds));
        reopens = 0;
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

  // A close while the finger is down, or just after it lifts, is not the person's: open it again.
  document.addEventListener(
    "toggle",
    (event) => {
      const list = opened;
      if (!list || event.target !== list || (event as ToggleEvent).newState !== "closed") return;
      if (performance.now() > graceEnds || reopens >= MAX_REOPENS) {
        release();
        return;
      }
      reopens += 1;
      if (!list.matches(":popover-open")) list.showPopover();
    },
    true,
  );

  // A key, or a click (the hold's own is cancelled above), is the person closing or picking: that
  // close is theirs, whatever the clock says (Escape, a keyboard or screen reader activation). A
  // click from script is not: the iPhone's haptic tick is one (design-system/haptics.ts), made as the
  // sheet opens, and would end the hold before the lift it exists for.
  document.addEventListener("keydown", release, true);
  document.addEventListener("click", (event) => event.isTrusted && release(), true);

  // Android reads a hold on a link as its link menu, and iOS and Android as a drag of it: the card
  // has its own menu now. A mouse's right click keeps the browser's (copy link).
  document.addEventListener("contextmenu", (event) => {
    if (!matchMedia(TOUCH).matches) return;
    if ((event.target as Element).closest?.("[data-card] .card-link")) event.preventDefault();
  });
}
