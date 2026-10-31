/**
 * The cover that carries you in and out. Opening a briefing or an episode, its cover leaves the card
 * you pressed and settles as the page's hero; going back, it returns to its card. The move itself
 * stays a swap with no pictures of the page (navigationBoost.ts): a copy of the leaving cover, drawn
 * over the page, flies from the old box to the new one while the page underneath fades up, so a move
 * costs no frames and the cover is the one thing the eye can follow.
 *
 * A move with reduced motion, or to a page whose cover is not on screen, has no flight.
 */

import { navigationKind } from "./navigation";

/**
 * A cover's corner in pixels. The cover caps its corner at a quarter of its size (D268), so the
 * computed value can be `min(40px, 25%)`, which `parseFloat` reads as NaN; resolve each term here.
 */
function cornerPx(element: HTMLElement, width: number): number {
  const raw = getComputedStyle(element).borderTopLeftRadius;
  const terms = [...raw.matchAll(/(-?[\d.]+)(px|%)/g)].map(([, n, unit]) =>
    unit === "%" ? (Number(n) / 100) * width : Number(n),
  );
  if (terms.length === 0) return 0;
  return raw.startsWith("min(") ? Math.min(...terms) : (terms[0] ?? 0);
}

const COVER = ".cover[data-cover-id]";
const MORPH_CLASS = "cover-morph";

/** A cover drawn at `first` that lands at `last`: the translation and the scale that put one box on the other. */
export function flight(
  first: { left: number; top: number; width: number },
  last: { left: number; top: number; width: number },
): { dx: number; dy: number; scale: number } {
  return { dx: first.left - last.left, dy: first.top - last.top, scale: first.width / last.width };
}

/** The id of the cover that travels: the one on the press's card going in, the hero going out. */
export function travellingId(kind: string, from: URL, to: URL, root: ParentNode): string | null {
  if (kind === "in") return to.pathname.replace(/\/+$/, "").split("/").pop() || null;
  if (kind === "out") {
    const hero = root.querySelector<HTMLElement>(`${COVER}[data-size="hero"]`);
    return hero?.dataset.coverId ?? from.pathname.split("/").filter(Boolean).pop() ?? null;
  }
  return null;
}

function milliseconds(value: string): number {
  const number = Number.parseFloat(value);
  return value.trim().endsWith("ms") ? number : number * 1000;
}

/**
 * Where `element` stands once the page's own entrance has finished: the page slides a few pixels
 * into place as it arrives (view-transitions.css), and a cover that landed on the box measured
 * mid-slide would end that far off and jump. The entrance is wound to its end for the measure and
 * put back.
 */
function settledRect(element: Element): DOMRect {
  const entrance = document
    .getAnimations()
    .filter(
      (animation) =>
        animation.timeline instanceof DocumentTimeline &&
        (animation.effect as KeyframeEffect | null)?.target?.contains(element) === true &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime),
    );
  const times = entrance.map((animation) => animation.currentTime);
  for (const animation of entrance) {
    animation.currentTime = Number(animation.effect?.getComputedTiming().endTime);
  }
  const rect = element.getBoundingClientRect();
  entrance.forEach((animation, index) => {
    animation.currentTime = times[index] ?? 0;
  });
  return rect;
}

function onScreen(rect: DOMRect): boolean {
  return (
    rect.width > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth
  );
}

interface Held {
  id: string;
  kind: string;
  clone: HTMLElement;
  first: DOMRect;
  radius: number;
}

export function installCoverMorph(): void {
  let id: string | null = null;
  let kind = "none";
  let held: Held | null = null;
  let flying: Animation | null = null;

  const land = (): void => {
    flying?.cancel();
    flying = null;
    for (const stray of document.querySelectorAll(`.${MORPH_CLASS}`)) stray.remove();
    for (const hidden of document.querySelectorAll<HTMLElement>(`${COVER}[data-morphing]`)) {
      hidden.removeAttribute("data-morphing");
    }
  };

  document.addEventListener("astro:before-preparation", (event) => {
    land();
    held = null;
    kind = navigationKind(event.from, event.to);
    id = travellingId(kind, event.from, event.to, document);
  });

  document.addEventListener("astro:before-swap", () => {
    if (id === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The cover on the page that is leaving: the hero going out, the pressed card's going in.
    const covers = [...document.querySelectorAll<HTMLElement>(`${COVER}[data-cover-id="${id}"]`)];
    const wanted = kind === "out" ? covers.filter((c) => c.dataset.size === "hero") : covers;
    const source = wanted.find((cover) => onScreen(cover.getBoundingClientRect()));
    if (!source) return;
    const first = source.getBoundingClientRect();
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.add(MORPH_CLASS);
    clone.setAttribute("aria-hidden", "true");
    held = {
      id,
      kind,
      clone,
      first,
      radius: cornerPx(source, first.width),
    };
  });

  document.addEventListener("astro:after-swap", () => {
    const flightOf = held;
    held = null;
    if (!flightOf) return;
    // Going in the page's hero receives the cover; going out, the card it came from, if it is shown.
    const targets = [
      ...document.querySelectorAll<HTMLElement>(`${COVER}[data-cover-id="${flightOf.id}"]`),
    ];
    const target = targets.find((cover) =>
      flightOf.kind === "in" ? cover.dataset.size === "hero" : cover.dataset.size !== "hero",
    );
    if (!target) return;
    const last = settledRect(target);
    if (!onScreen(last)) return;

    const { dx, dy, scale } = flight(flightOf.first, last);
    const style = getComputedStyle(document.documentElement);
    const duration = milliseconds(style.getPropertyValue("--duration-enter"));
    const easing = style.getPropertyValue("--ease-out").trim() || "ease-out";
    const endRadius = cornerPx(target, last.width);

    const { clone } = flightOf;
    // Drawn at the landing box and sent back to the starting one, so the final frame is exact.
    clone.style.left = `${last.left}px`;
    clone.style.top = `${last.top}px`;
    clone.style.width = `${last.width}px`;
    target.setAttribute("data-morphing", "");
    document.body.append(clone);

    // The radius is a length on the box, which the scale carries with it: its start is the starting
    // card's radius seen through the scale, so the corner is the same size on screen.
    flying = clone.animate(
      [
        {
          transformOrigin: "0 0",
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          borderRadius: `${flightOf.radius / scale}px`,
        },
        { transformOrigin: "0 0", transform: "none", borderRadius: `${endRadius}px` },
      ],
      { duration, easing },
    );
    const done = (): void => {
      clone.remove();
      target.removeAttribute("data-morphing");
      flying = null;
    };
    flying.finished.then(done, done);
  });
}
