import { stickyTop } from "./stickyTop";

/**
 * The Library list's month headings carry no band until they are held under the top chrome, and the
 * band eases in then (owner, 2026-11-04: a band behind every month showed over the Halloween web).
 * A heading is held once the first card of its month has risen to where the heading's own place is,
 * so each heading is told by the card after it: IntersectionObserver reads where a card is against a
 * line, and a card is not sticky. `data-stuck` is the held heading; library.css draws its band.
 *
 * The next heading pushes the held one out of the slot (owner, 2026-11-05: a gap showed between the
 * two, as Spotify's list has none). Over the last heading-height of travel the arriving heading is
 * flush against the held one's bottom edge, so the held one moves up by exactly the overlap, as one
 * piece with it, and the new heading takes its place. Only in that span is a scroll listener on, and
 * it moves a single custom property (`--push`) on the held heading, once a frame.
 * `--sticky-top` moves with the app bar below 64rem and the lines are drawn from where it ends up, so
 * they are drawn again when the bar goes or comes.
 */
// A card is a few rows tall: a dozen steps put the change within a few pixels of the line.
const STEPS = Array.from({ length: 11 }, (_, step) => step / 10);

export function installMonthBands(root: HTMLElement, grid: HTMLElement): void {
  let observers: IntersectionObserver[] = [];
  let held: HTMLElement[] = [];
  let release = (): void => {};
  let queued = false;

  const watch = (): void => {
    queued = false;
    release();
    for (const observer of observers) observer.disconnect();
    observers = [];
    for (const head of held) head.style.removeProperty("--push");
    // In the gallery the headings are not drawn.
    const heads = [...grid.querySelectorAll<HTMLElement>("[data-month-head]")].filter(
      (head) => head.offsetParent !== null,
    );
    held = heads;
    const first = heads[0];
    if (!first) return;
    const from = stickyTop();
    const height = first.offsetHeight;
    const after = new Map<Element, HTMLElement>();
    for (const head of heads) {
      const card = head.nextElementSibling;
      if (card) after.set(card, head);
    }
    const before = new Map(
      heads.slice(1).map((head, index) => [head, heads[index] as HTMLElement]),
    );

    // Each heading is near when its card is within two heights of the line (the last height of that
    // is the push) and held once the card has reached its own place.
    const near = new Set<HTMLElement>();
    const stuck = new Set<HTMLElement>();
    const moving = new Set<HTMLElement>();
    let frame = 0;
    let listening = false;

    const place = (head: HTMLElement, overlap: number): void => {
      const earlier = before.get(head);
      if (!earlier) return;
      const push = Math.min(Math.max(overlap, 0), height);
      if (push > 0) earlier.style.setProperty("--push", `${push}px`);
      else earlier.style.removeProperty("--push");
    };
    const update = (): void => {
      frame = 0;
      for (const head of moving) {
        const card = head.nextElementSibling;
        if (card) place(head, from + 2 * height - card.getBoundingClientRect().top);
      }
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const settle = (head: HTMLElement): void => {
      if (!near.has(head)) {
        moving.delete(head);
        place(head, 0);
      } else if (stuck.has(head)) {
        moving.delete(head);
        place(head, height);
      } else {
        moving.add(head);
      }
      update();
      const wanted = moving.size > 0;
      if (wanted === listening) return;
      listening = wanted;
      if (wanted) addEventListener("scroll", onScroll, { passive: true });
      else removeEventListener("scroll", onScroll);
    };
    release = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      removeEventListener("scroll", onScroll);
      listening = false;
    };

    for (const [reach, marks] of [
      [0, stuck],
      [2 * height, near],
    ] as const) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const head = after.get(entry.target);
            if (!head) continue;
            const line = entry.rootBounds?.top ?? 0;
            const on = entry.boundingClientRect.top < line;
            if (on) marks.add(head);
            else marks.delete(head);
            if (marks === stuck) head.toggleAttribute("data-stuck", on);
            settle(head);
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
      release();
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
