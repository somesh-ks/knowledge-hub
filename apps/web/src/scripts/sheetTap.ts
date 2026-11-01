/**
 * A press outside a phone's menu sheet closes it and reaches nothing underneath (owner, 2026-10-31:
 * a tap beside the sheet closed it and then opened the page under his finger, so the sheet "went up
 * and vanished" with the page). The popover's light dismiss hides the sheet, and with it its scrim,
 * when the finger lifts; the click that follows is then hit-tested against the page behind it. This
 * swallows that one click. A dialog sheet already does the same (dismissOnScrim, pullDismiss.ts).
 */
import { MENU_SELECTORS } from "../design-system/menu";

/** Matches menu.css: the sheet and its scrim exist below this width only. */
const PHONE = "(width < 40rem)";
/** A tap's click follows its lift at once; a press held longer than this makes no click to swallow. */
const CLICK_WINDOW_MS = 1000;

let installed = false;

export function installSheetTapGuard(): void {
  if (installed) return;
  installed = true;

  let pressedAt = 0;

  document.addEventListener(
    "pointerdown",
    (event) => {
      pressedAt = 0;
      if (!matchMedia(PHONE).matches) return;
      const sheet = document.querySelector<HTMLElement>(`${MENU_SELECTORS.sheet}:popover-open`);
      if (!sheet) return;
      const box = sheet.getBoundingClientRect();
      const outside =
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom;
      if (outside) pressedAt = performance.now();
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const swallow = pressedAt > 0 && performance.now() - pressedAt < CLICK_WINDOW_MS;
      pressedAt = 0;
      if (!swallow) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
