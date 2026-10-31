/**
 * The gestures every sheet shares on a phone (2026-10-21, D144). Pull down to dismiss: a drag that
 * starts on the head, or anywhere once the body is scrolled to its top, moves the sheet with the
 * finger, and a release past a quarter of its height, or a flick down, closes it. A shorter pull
 * springs back. Touch events, not pointer events, so the drag can take the gesture from the
 * browser's own scrolling (a pointer stream would be cancelled the moment the page scrolls).
 * From 40rem the sheet is a side panel, a menu or a dialog and this does nothing. Under reduced
 * motion the sheet does not follow the finger; the release still closes it.
 *
 * Works on a <dialog> (modal) and on a popover (a menu sheet). A tap on the scrim closes a dialog
 * (`dismissOnScrim`); a popover has light dismiss of its own.
 */

import { drawerHeadClass, drawerPanelClass } from "../design-system/drawer";
import { MENU_SELECTORS } from "../design-system/menu";
import { sheetBodyClass, sheetHeadClass } from "../design-system/sheet";

const HEAD = `.${sheetHeadClass()}, .${drawerHeadClass()}`;
const BODY = `.${sheetBodyClass()}, ${MENU_SELECTORS.body}, .${drawerPanelClass()}, .emoji-body, .gen-body`;

/** A pull this far down before the sheet follows, so a tap or a sideways swipe never moves it. */
const SLOP_PX = 10;
/** A release faster than this (px per ms) closes the sheet, however short the pull. */
const FLICK = 0.5;
/** A finger that rested this long (ms) before it lifted made no flick. */
const FLICK_WINDOW_MS = 100;

export function pullToDismiss(sheet: HTMLElement, close: () => void): void {
  const phone = matchMedia("(width < 40rem)");
  const head = sheet.querySelector<HTMLElement>(HEAD);
  const body = sheet.querySelector<HTMLElement>(BODY);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let armed = false;
  let pulling = false;
  let startX = 0;
  let startY = 0;
  let dy = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;

  const reset = (): void => {
    armed = false;
    pulling = false;
    dy = 0;
  };

  sheet.addEventListener(
    "touchstart",
    (event) => {
      reset();
      const touch = event.touches[0];
      if (!phone.matches || event.touches.length !== 1 || !touch) return;
      const target = event.target as Element;
      // A field, a slider or a list keeps its own gesture.
      if (target.closest("input, textarea, select, [role=listbox]")) return;
      const onHead = head?.contains(target) ?? false;
      armed = onHead || !body || body.scrollTop <= 0;
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      lastT = event.timeStamp;
      speed = 0;
    },
    { passive: true },
  );

  sheet.addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (!armed || !touch) return;
      dy = touch.clientY - startY;
      if (!pulling) {
        const dx = touch.clientX - startX;
        if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
          armed = false;
          return;
        }
        // Up first is a scroll of the body: leave it to the browser for the rest of the touch.
        if (dy < -SLOP_PX) {
          armed = false;
          // A body with nothing to scroll must not hand the swipe to the page behind the sheet.
          if (body && body.scrollHeight <= body.clientHeight && event.cancelable) {
            event.preventDefault();
          }
          return;
        }
        // A small move down at the top is held back from the browser, so it never starts an
        // overscroll it would then keep: once it has, the pull could no longer be cancelled.
        if (dy < SLOP_PX) {
          if (dy > 0 && event.cancelable) event.preventDefault();
          return;
        }
        pulling = true;
        startY = touch.clientY;
        dy = 0;
      }
      event.preventDefault();
      const elapsed = event.timeStamp - lastT;
      if (elapsed > 0) speed = (touch.clientY - lastY) / elapsed;
      lastY = touch.clientY;
      lastT = event.timeStamp;
      if (!still.matches) sheet.style.translate = `0 ${Math.max(0, dy)}px`;
    },
    { passive: false },
  );

  const release = (event: TouchEvent): void => {
    if (!pulling) {
      reset();
      return;
    }
    const pulled = Math.max(0, dy);
    reset();
    // A cancelled touch (the system took it) only springs back; it never closes.
    const flicked = speed > FLICK && event.timeStamp - lastT < FLICK_WINDOW_MS;
    if (event.type === "touchend" && (pulled > sheet.clientHeight / 4 || flicked)) {
      // The sheet leaves from where the finger let go: its exit slide adds to this offset.
      close();
      return;
    }
    sheet.style.translate = "";
    if (still.matches) return;
    sheet.animate([{ translate: `0 ${pulled}px` }, { translate: "0 0" }], {
      duration: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  };
  sheet.addEventListener("touchend", release);
  sheet.addEventListener("touchcancel", release);

  // A sheet closed from where the finger let go keeps that offset for its exit; once the exit is
  // over the next opening starts from rest.
  const settle = (): void => {
    void Promise.allSettled(sheet.getAnimations().map((animation) => animation.finished)).then(
      () => {
        const open =
          sheet instanceof HTMLDialogElement ? sheet.open : sheet.matches(":popover-open");
        if (!open) sheet.style.translate = "";
      },
    );
  };
  sheet.addEventListener(sheet instanceof HTMLDialogElement ? "close" : "toggle", settle);
}

/**
 * A tap on the scrim closes a dialog (2026-10-21, D144). A press on the scrim lands on the dialog
 * itself, but so does one on its own padding, so the point must also be outside its box. A press
 * that starts inside and ends outside (selecting text, sliding off a chip) also clicks the dialog,
 * so only one that began on the scrim closes it.
 */
export function dismissOnScrim(
  dialog: HTMLDialogElement,
  close: () => void = () => dialog.close(),
): void {
  const outside = (event: MouseEvent): boolean => {
    const box = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom)
    );
  };
  let fromScrim = false;
  dialog.addEventListener("pointerdown", (event) => {
    fromScrim = outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (fromScrim && outside(event)) close();
    fromScrim = false;
  });
}

/** Everything a sheet does with a finger: pulled down it closes, tapped outside it closes. */
export function sheetGestures(
  dialog: HTMLDialogElement,
  close: () => void = () => dialog.close(),
): void {
  pullToDismiss(dialog, close);
  dismissOnScrim(dialog, close);
}
