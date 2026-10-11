/**
 * The floating button, as Android draws a screen's primary action: Create on Today and the Library,
 * Play on an episode or an older briefing, both .create-fab. Extended (the glyph and the word) at
 * the top of a page and while scrolling back up, folded to the glyph while scrolling down to read.
 * app.ts loads this on the first scroll, so the first load does not carry it. The button is looked
 * up on every frame because a move between pages replaces it.
 */

/** Scroll this far in one direction before the button changes, so a resting thumb does not flicker it. */
export const FOLD_STEP_PX = 8;
/** Near the top of a page the button is always extended. */
export const FOLD_TOP_PX = 48;

/** Whether the button is folded after a scroll from `from` to `to`, or null to leave it as it is. */
export function foldedAfter(from: number, to: number): boolean | null {
  if (to <= FOLD_TOP_PX) return false;
  if (Math.abs(to - from) < FOLD_STEP_PX) return null;
  return to > from;
}

let installed = false;

export function installFabScroll(): void {
  if (installed) return;
  installed = true;
  let last = window.scrollY;
  let queued = false;
  const update = (): void => {
    queued = false;
    const now = window.scrollY;
    const folded = foldedAfter(last, now);
    if (folded === null) return;
    last = now;
    document.querySelector<HTMLElement>(".create-fab")?.toggleAttribute("data-folded", folded);
  };
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );
  // A new page starts at its top with the button extended; the next scroll measures from there.
  document.addEventListener("astro:page-load", () => {
    last = window.scrollY;
  });
}
