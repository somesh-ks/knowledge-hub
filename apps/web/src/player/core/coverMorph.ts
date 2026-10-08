import { clamp, lerp } from "./mathUtils";

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
 * Coordinates are in the surface's own box, from layout alone, so a bar or a page that is already
 * transformed when the measurement is taken does not skew it.
 */
export interface CoverMorph {
  /** The bar's thumbnail: where the flying cover sits at p = 0. */
  fromX: number;
  fromY: number;
  /** The page's cover slot: where it sits at p = 1. */
  toX: number;
  toY: number;
  /** Width of the flying cover at rest on the page. */
  size: number;
  /** Thumbnail width over resting width: the scale at p = 0. */
  scale: number;
}

/**
 * `scrollTop` is how far the page was scrolled when the motion began. The slot sits that much
 * higher than its layout box, so a page closed while scrolled hands the cover over from where it
 * actually was.
 */
export function computeMorph(thumb: BoxLike, slot: BoxLike, scrollTop = 0): CoverMorph | null {
  if (slot.width <= 0 || thumb.width <= 0) return null;
  return {
    fromX: thumb.left,
    fromY: thumb.top,
    toX: slot.left,
    toY: slot.top - Math.max(0, scrollTop),
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
