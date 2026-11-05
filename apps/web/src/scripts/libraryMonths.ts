import { stickyTop } from "./stickyTop";

/**
 * The Library list's month headings carry no band until they are held under the top chrome, and the
 * band eases in then (owner, 2026-11-04: a band behind every month showed over the Halloween web).
 * A heading is held once the first card of its month has risen to where the heading's own place is,
 * so each heading is told by the card after it: IntersectionObserver reads where a card is against a
 * line, a card is not sticky, and a scroll handler is not needed. `data-stuck` is the held heading
 * (library.css draws its band); `data-near` is a heading within its own height of being held, which
 * lifts the headings above it out of the way, so two labels never run over each other before the
 * band that covers the earlier one is there. `--sticky-top` moves with the app bar below 64rem and
 * the lines are drawn from where it ends up, so they are drawn again when the bar goes or comes.
 */
// A card is a few rows tall: a dozen steps put the change within a few pixels of the line.
const STEPS = Array.from({ length: 11 }, (_, step) => step / 10);

export function installMonthBands(root: HTMLElement, grid: HTMLElement): void {
  let observers: IntersectionObserver[] = [];
  let queued = false;

  const watch = (): void => {
    queued = false;
    for (const observer of observers) observer.disconnect();
    observers = [];
    // In the gallery the headings are not drawn.
    const heads = [...grid.querySelectorAll<HTMLElement>("[data-month-head]")].filter(
      (head) => head.offsetParent !== null,
    );
    const first = heads[0];
    if (!first) return;
    const from = stickyTop();
    const height = first.offsetHeight;
    const after = new Map<Element, HTMLElement>();
    for (const head of heads) {
      const card = head.nextElementSibling;
      if (card) after.set(card, head);
    }
    for (const [reach, mark] of [
      [0, "data-stuck"],
      [height, "data-near"],
    ] as const) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const line = entry.rootBounds?.top ?? 0;
            after.get(entry.target)?.toggleAttribute(mark, entry.boundingClientRect.top < line);
          }
        },
        { rootMargin: `-${Math.round(from + height + reach)}px 0px 0px 0px`, threshold: STEPS },
      );
      for (const card of after.keys()) observer.observe(card);
      observers.push(observer);
    }
  };
  const later = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(watch);
  };

  // The list is rebuilt as it is searched, filtered and sorted; the view and the bar change the lines.
  const changes = new MutationObserver(later);
  changes.observe(grid, { childList: true });
  changes.observe(root, { attributes: true, attributeFilter: ["data-view"] });
  changes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-bar-hidden"],
  });
  addEventListener("resize", later);
  document.addEventListener(
    "astro:before-swap",
    () => {
      for (const observer of observers) observer.disconnect();
      changes.disconnect();
      removeEventListener("resize", later);
    },
    { once: true },
  );
  // Drawn only once the lines are, so a page without the script keeps its band.
  root.dataset.monthBands = "";
  watch();
}
