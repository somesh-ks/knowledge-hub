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
      swiped = false;
      start =
        event.pointerType === "mouse"
          ? null
          : { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > SWIPE_PX) swiped = true;
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
