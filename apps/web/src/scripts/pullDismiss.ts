/**
 * Pull down to dismiss a full-screen sheet on a phone (2026-10-20), beside its close button: a drag
 * that starts on the head, or anywhere once the body is scrolled to its top, moves the sheet with
 * the finger, and a release past a quarter of its height, or a flick down, closes it. A shorter pull
 * springs back. Touch events, not pointer events, so the drag can take the gesture from the
 * browser's own scrolling (a pointer stream would be cancelled the moment the page scrolls).
 * From 40rem the sheet is a side panel and this does nothing.
 */

/** A pull this far down before the sheet follows, so a tap or a sideways swipe never moves it. */
const SLOP_PX = 10;
/** A release faster than this (px per ms) closes the sheet, however short the pull. */
const FLICK = 0.5;

export function pullToDismiss(sheet: HTMLDialogElement, close: () => void): void {
  const phone = matchMedia("(width < 40rem)");
  const head = sheet.querySelector<HTMLElement>(".create-sheet-head");
  const body = sheet.querySelector<HTMLElement>(".create-sheet-body");
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
          return;
        }
        if (dy < SLOP_PX) return;
        pulling = true;
        startY = touch.clientY;
        dy = 0;
      }
      event.preventDefault();
      const elapsed = event.timeStamp - lastT;
      if (elapsed > 0) speed = (touch.clientY - lastY) / elapsed;
      lastY = touch.clientY;
      lastT = event.timeStamp;
      sheet.style.translate = `0 ${Math.max(0, dy)}px`;
    },
    { passive: false },
  );

  const release = (): void => {
    if (!pulling) {
      reset();
      return;
    }
    const pulled = Math.max(0, dy);
    reset();
    if (pulled > sheet.clientHeight / 4 || speed > FLICK) {
      // The sheet leaves from where the finger let go: its exit slide adds to this offset.
      close();
      return;
    }
    sheet.style.translate = "";
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    sheet.animate([{ translate: `0 ${pulled}px` }, { translate: "0 0" }], {
      duration: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  };
  sheet.addEventListener("touchend", release);
  sheet.addEventListener("touchcancel", release);
}
