import { TAP_SLOP_PX } from "../player/core/gestureMath";

/**
 * When a sideways swipe takes its row or toast away (D161, D162), shared by the toast and the queue
 * so the two never drift: past this share of the width, or this fast over the last 100 ms (the
 * player's velocity tracker), and never short of twice the tap slop, so a thumb that drifts under a
 * tap is a tap. The slop itself (TAP_SLOP_PX) says when a press has become a swipe at all.
 */
export const SWIPE_SHARE = 0.35;
export const SWIPE_SPEED = 0.6;
export const SWIPE_MIN_PX = TAP_SLOP_PX * 2;

export function swipeLeaves(dx: number, width: number, velocityPxPerMs: number): boolean {
  const away = Math.abs(dx);
  if (away < SWIPE_MIN_PX) return false;
  return away > width * SWIPE_SHARE || Math.abs(velocityPxPerMs) > SWIPE_SPEED;
}
