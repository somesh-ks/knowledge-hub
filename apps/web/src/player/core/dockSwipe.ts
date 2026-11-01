/**
 * The dock's sideways swipe: a finger moves what plays to the next queued item (to the left) or back
 * to the one before (to the right). The bar's cover and title follow the finger a short way and fade;
 * the neighbour's come in from the other side. Nothing travels far (owner, 2026-11-01).
 */

/** How far the finger goes, in px, for the switch to be whole. */
export const SWIPE_SPAN_PX = 96;
/** How far the neighbour's cover and title start from their place, in px. */
export const SWIPE_ENTER_PX = 40;
/** The share of the span a slow release must pass to switch. */
const SWITCH_SHARE = 0.4;
/** px/ms of a flick that switches without the distance. */
const FLICK_VELOCITY = 0.35;
/** Where nothing waits, the bar gives this share of the finger's travel, and no more than the cap. */
const RESIST_SHARE = 0.25;
const RESIST_CAP_PX = 20;
/** A flick must still have travelled this far, so a brush is not a switch. */
const FLICK_MIN_PX = 16;

export interface SwipeFrame {
  /** Where the bar's own cover and title stand, in px from their place. */
  offset: number;
  /** 0 at rest, 1 when the switch is whole: how far the bar has faded out and the neighbour in. */
  share: number;
}

/** The bar for a finger `dx` px from where it went down; `hasTarget` is false with nothing to go to. */
export function swipeFrame(dx: number, hasTarget: boolean): SwipeFrame {
  if (!hasTarget) {
    const offset = Math.sign(dx) * Math.min(Math.abs(dx) * RESIST_SHARE, RESIST_CAP_PX);
    return { offset, share: 0 };
  }
  const share = Math.min(Math.abs(dx) / SWIPE_SPAN_PX, 1);
  // Past the span the bar stays put: the rest of the travel is the finger's, not the bar's.
  return { offset: Math.sign(dx) * Math.min(Math.abs(dx), SWIPE_SPAN_PX), share };
}

/** Whether a lift switches: far enough, or fast enough in the direction it went, with somewhere to go. */
export function swipeSwitches(dx: number, velocityPxPerMs: number, hasTarget: boolean): boolean {
  if (!hasTarget || dx === 0) return false;
  if (Math.abs(dx) >= SWIPE_SPAN_PX * SWITCH_SHARE && velocityPxPerMs * dx > -0.1) return true;
  return Math.abs(dx) >= FLICK_MIN_PX && velocityPxPerMs * Math.sign(dx) > FLICK_VELOCITY;
}
