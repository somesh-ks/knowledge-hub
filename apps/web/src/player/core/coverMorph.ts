import { clamp, lerp } from "./mathUtils";

/** A box in the surface's own coordinates. Square covers need only one side. */
export interface BoxLike {
  left: number;
  top: number;
  width: number;
}

/**
 * The cover's flight between the bar and the page, as FLIP driven by one progress variable `p`
 * (0 collapsed, 1 expanded). Both ends are measured once, when the page leaves rest; every frame
 * after that is a transform the stylesheet computes from `p`, so a finger, a tap and a spring all
 * take the same path and any of them can interrupt another from the live value.
 *
 * The flying cover is laid out at the page cover's size and only ever scaled down from it, so it is
 * drawn from the large image and never blurs on the way up.
 */
export interface CoverMorph {
  /** The bar's thumbnail: where the flying cover sits at p = 0. */
  fromX: number;
  fromY: number;
  /** The page's cover, as the page shows it once it is open: where the cover sits at p = 1. */
  toX: number;
  toY: number;
  /** Width of the flying cover at rest on the page. */
  size: number;
  /** Thumbnail width over resting width: the scale at p = 0. */
  scale: number;
}

/** A box as the browser draws it, in window coordinates. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
}

/**
 * Where a cover rests in the surface, from boxes read while its part (the page, or the bar it
 * rides in) may be anywhere on its way: the cover's drawn box less its part's, which takes out the
 * part's transform and keeps the page's scroll, plus where layout puts the part in the surface.
 * Drawn boxes keep the fractions that offsetLeft and offsetTop round away, so the flying cover
 * meets the real one to the subpixel.
 */
export function restingBox(
  cover: RectLike,
  part: RectLike,
  partAtRest: { left: number; top: number },
): BoxLike {
  return {
    left: cover.left - part.left + partAtRest.left,
    top: cover.top - part.top + partAtRest.top,
    width: cover.width,
  };
}

/**
 * `thumb` is where the bar's thumbnail rests and `slot` where the page's cover will be once the
 * page is up, scroll included, so a page closed while scrolled hands the cover over from where it
 * actually was. Null when either has no size, as when a cover is not laid out.
 */
export function computeMorph(thumb: BoxLike, slot: BoxLike): CoverMorph | null {
  if (slot.width <= 0 || thumb.width <= 0) return null;
  return {
    fromX: thumb.left,
    fromY: thumb.top,
    toX: slot.left,
    toY: slot.top,
    size: slot.width,
    scale: thumb.width / slot.width,
  };
}

export interface CoverFrame {
  x: number;
  y: number;
  scale: number;
}

/**
 * The cover's transform at progress `p`. The stylesheet computes the same three numbers from the
 * properties below; this is the formula in one place, and the tests hold the two together.
 */
export function coverFrame(progress: number, morph: CoverMorph): CoverFrame {
  const visual = clamp(progress, 0, 1);
  return {
    x: lerp(morph.fromX, morph.toX, visual),
    y: lerp(morph.fromY, morph.toY, visual),
    scale: lerp(morph.scale, 1, visual),
  };
}

/** The custom properties a morph is written as, once per motion, on the flying cover. */
export const MORPH_PROPERTIES = [
  "--art-from-x",
  "--art-from-y",
  "--art-to-x",
  "--art-to-y",
  "--art-size",
  "--art-scale",
] as const;

export type MorphProperty = (typeof MORPH_PROPERTIES)[number];

export function morphStyle(morph: CoverMorph): Record<MorphProperty, string> {
  return {
    "--art-from-x": `${morph.fromX}px`,
    "--art-from-y": `${morph.fromY}px`,
    "--art-to-x": `${morph.toX}px`,
    "--art-to-y": `${morph.toY}px`,
    "--art-size": `${morph.size}px`,
    "--art-scale": String(morph.scale),
  };
}
