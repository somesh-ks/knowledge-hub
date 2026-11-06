/**
 * The favorite glow (owner, 2026-11-06, option A of the Favorite glow): as Favorite turns on, a
 * pink halo opens from the heart's centre and fades, and the filled heart settles in. It is light,
 * not a fill: it spills past the control and the control keeps its size. Turning Favorite off, and a
 * heart already filled when a page loads, show nothing. Times, curves and colour are the
 * stylesheet's (glow.css), on the project's motion tokens; reduced motion shows no glow.
 */
import type { Guidance } from "./guidance";

export const GLOW: Guidance = {
  summary: "A pink halo from the heart as Favorite turns on.",
  useWhen: ["A person turns Favorite on."],
  dontUseWhen: [
    { when: "Favorite turns off, or a page loads a filled heart." },
    { when: "Any other control confirms a press.", instead: "Ripple" },
  ],
};

/** Every class the glow draws, for the registry and its test. */
export const GLOW_CLASSES: string[] = ["glow-halo"];

/** Classes the glow replaced; none, as it is new. */
export const GLOW_RETIRED: string[] = [];

/** The attribute a control wears while it glows: the heart's settle keys on it. */
export const GLOWING = "data-glow";

/**
 * Plays the glow on `control`, a Favorite that has just turned on: call it after the control shows
 * its filled heart, so the halo opens from where the heart is. A second call restarts it.
 */
export function glowFavorite(control: HTMLElement): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  control.querySelector(":scope > .glow-halo")?.remove();
  const heart = control.querySelector<Element>('[data-icon="heart"]');
  const box = control.getBoundingClientRect();
  const glyph = heart?.getBoundingClientRect();
  const halo = document.createElement("span");
  halo.className = "glow-halo";
  halo.setAttribute("aria-hidden", "true");
  // From the heart's centre; the control's own where no heart shows.
  const x = glyph?.width ? glyph.left + glyph.width / 2 - box.left : box.width / 2;
  const y = glyph?.height ? glyph.top + glyph.height / 2 - box.top : box.height / 2;
  halo.style.setProperty("--glow-x", `${x}px`);
  halo.style.setProperty("--glow-y", `${y}px`);
  const room = roomAround(control, box.left + x, box.top + y);
  // The gradient is clear at 70% of the radius, so a halo up to room / 0.35 wide never meets the
  // edge of a box that clips it (the hero's row scrolls sideways): a cut edge would read as a box.
  if (room < Number.POSITIVE_INFINITY) halo.style.setProperty("--glow-room", `${room / 0.35}px`);
  control.removeAttribute(GLOWING);
  void control.offsetWidth;
  control.setAttribute(GLOWING, "");
  control.prepend(halo);
  halo.addEventListener("animationend", () => {
    halo.remove();
    control.removeAttribute(GLOWING);
  });
}

/** How far the point (x, y) is from the nearest edge of a box around `control` that clips it. */
function roomAround(control: HTMLElement, x: number, y: number): number {
  let room = Number.POSITIVE_INFINITY;
  for (let box = control.parentElement; box; box = box.parentElement) {
    const style = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    if (style.overflowX !== "visible") room = Math.min(room, x - rect.left, rect.right - x);
    if (style.overflowY !== "visible") room = Math.min(room, y - rect.top, rect.bottom - y);
  }
  return Math.max(room, 0);
}
