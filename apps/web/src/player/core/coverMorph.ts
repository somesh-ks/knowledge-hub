import { clamp, lerp } from "./mathUtils";

export interface RectLike {
  left: number;
  top: number;
  width: number;
}

/** The mini player's cover relative to the player cover's resting place. */
export interface CoverMorph {
  /** Scale at p = 0: mini width over resting width. */
  scaleAtClosed: number;
  dx: number;
  dy: number;
}

/**
 * The shared-element morph, as FLIP driven by one progress variable `p` (0 closed, 1 open). First
 * and Last are measured once when the sheet starts to move; every frame after that is a transform
 * computed from `p`, so a finger, a tap and a spring all take the same path and any of them can be
 * interrupted from the live value.
 */
export function computeMorph(mini: RectLike, resting: RectLike): CoverMorph | null {
  if (resting.width <= 0 || mini.width <= 0) return null;
  return {
    scaleAtClosed: mini.width / resting.width,
    dx: mini.left - resting.left,
    dy: mini.top - resting.top,
  };
}

export interface CoverFrame {
  x: number;
  y: number;
  scale: number;
}

/**
 * The panel itself translates by (1 - p) * height, so the cover's own offset subtracts that to land
 * on the mini player's cover at p = 0 and on its resting place at p = 1.
 */
export function coverFrame(progress: number, morph: CoverMorph, panelHeight: number): CoverFrame {
  const visual = clamp(progress, 0, 1);
  return {
    x: (1 - visual) * morph.dx,
    y: (1 - visual) * (morph.dy - panelHeight),
    scale: lerp(morph.scaleAtClosed, 1, visual),
  };
}

/** Scaling squeezes a corner radius, so it is divided by the scale to stay visually true. */
export function coverRadius(
  progress: number,
  thumbRadiusPx: number,
  restingRadiusPx: number,
  scale: number,
): number {
  const visual = clamp(progress, 0, 1);
  return lerp(thumbRadiusPx, restingRadiusPx, visual) / scale;
}

export function panelOffset(progress: number, panelHeight: number): number {
  return (1 - clamp(progress, 0, 1)) * panelHeight;
}

/** Wide layouts: a centered card that fades and scales in from `enterScale`. */
export function cardScale(progress: number, enterScale: number): number {
  return lerp(enterScale, 1, clamp(progress, 0, 1));
}
