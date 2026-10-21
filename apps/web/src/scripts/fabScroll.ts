/**
 * The floating button, as Android draws a screen's primary action: Create on the Library, Play on
 * Today, a briefing or an episode, both .create-fab. Extended (the glyph and the word) at
 * the top of a page and while scrolling back up, folded to the glyph while scrolling down to read.
 * app.ts loads this on the first scroll, so the first load does not carry it. The button is looked
 * up on every frame because a move between pages replaces it.
 */

/** Scroll this far in one direction before the button changes, so a resting thumb does not flicker it. */
export const FOLD_STEP_PX = 8;
/** Near the top of a page the button is always extended. */
export const FOLD_TOP_PX = 48;

/**
 * Whether the page is scrolled to its end. On a phone the URL bar collapsing or expanding there
 * changes the viewport's height and clamps scrollY: an upward step that is not the person's.
 */
export function atScrollEnd(): boolean {
  return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
}

/**
 * Whether the button is folded after a scroll from `from` to `to`, or null to leave it as it is.
 * `atEnd`: `to` is the end of the page, where an upward step is the viewport resizing, not a reveal.
 */
export function foldedAfter(from: number, to: number, atEnd = false): boolean | null {
  if (to <= FOLD_TOP_PX) return false;
  if (atEnd && to < from) return null;
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
    const atEnd = atScrollEnd();
    const folded = foldedAfter(last, now, atEnd);
    if (folded === null) {
      if (atEnd && now < last) last = now;
      return;
    }
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
  // The viewport's height changed (the URL bar): measure the next scroll from where the page is now.
  window.addEventListener("resize", () => {
    last = window.scrollY;
  });
  // A new page starts at its top with the button extended; the next scroll measures from there.
  document.addEventListener("astro:page-load", () => {
    last = window.scrollY;
  });
}
