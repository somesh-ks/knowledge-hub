import type { MouseEvent, PointerEvent } from "react";

/** A touch that travels this far is a swipe, as the sheet controller reads it. */
const SWIPE_PX = 12;
/** A click this soon after a swipe's lift is that swipe's echo, not a press. */
const ECHO_MS = 500;

/**
 * Capture handlers for a region where a touch can start on a button and become a swipe (the player's
 * controls, which scroll or dismiss under a finger): the click some browsers still send after that
 * lift is dropped, so a pull that began on Play never plays. A mouse and the keyboard (a click with
 * no detail) are untouched. Make one per component (useMemo): the state must outlive a render.
 */
export function swipeClickGuard() {
  let start: { id: number; x: number; y: number } | null = null;
  let swiped = false;
  let swipedAt = Number.NEGATIVE_INFINITY;
  return {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      // A new press is no echo of the last swipe: its own click must act.
      swipedAt = Number.NEGATIVE_INFINITY;
      swiped = false;
      // The speed dialog is no drag zone (zoneOf), so its slider drags are not swipes to guard.
      const ignored =
        event.pointerType === "mouse" ||
        (event.target instanceof Element && event.target.closest(".speed-panel") !== null);
      start = ignored ? null : { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
      if (!start || start.id !== event.pointerId) return;
      // The controller's own reading of a tap: each axis against the slop (gestureMath TAP_SLOP_PX).
      if (Math.max(Math.abs(event.clientX - start.x), Math.abs(event.clientY - start.y)) > SWIPE_PX)
        swiped = true;
    },
    onPointerUpCapture: (event: PointerEvent<HTMLElement>) => {
      if (start?.id === event.pointerId && swiped) swipedAt = event.timeStamp;
      start = null;
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (event.detail > 0 && Math.abs(event.timeStamp - swipedAt) < ECHO_MS) {
        event.stopPropagation();
        event.preventDefault();
      }
    },
  };
}
