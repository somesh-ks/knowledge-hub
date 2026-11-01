import type { MouseEvent, PointerEvent } from "react";

/** A lift this close to the button, past its edge, still counts as on it: a thumb drifts over a hold. */
const EDGE_SLOP_PX = 24;
/** A click this soon after a lift the press already handled is that lift's echo. */
const CLICK_ECHO_MS = 500;

/* Kept per button, outside the handlers: a lift that acts re-renders the bar, and the fresh handlers
   must still know the lift happened, or its click would act a second time. */
const pressed = new WeakMap<Element, number>();
const handledAt = new WeakMap<Element, number>();

/**
 * Press handlers for a button a thumb may hold before it lets go (owner, 2026-11-01: the dock's Play
 * did nothing when held for a second). A browser makes a click only when the finger stays put; a
 * hold that drifts a little becomes a pan, and no click comes. So a touch press acts on the lift
 * when it lands on or near the button, and the click that follows a handled lift is dropped. A
 * mouse and the keyboard still act on the click.
 */
export function heldTap(action: () => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pressed.set(event.currentTarget, event.pointerType === "mouse" ? -1 : event.pointerId);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (pressed.get(event.currentTarget) !== event.pointerId) return;
      pressed.delete(event.currentTarget);
      const box = event.currentTarget.getBoundingClientRect();
      const near =
        event.clientX >= box.left - EDGE_SLOP_PX &&
        event.clientX <= box.right + EDGE_SLOP_PX &&
        event.clientY >= box.top - EDGE_SLOP_PX &&
        event.clientY <= box.bottom + EDGE_SLOP_PX;
      if (!near) return;
      handledAt.set(event.currentTarget, event.timeStamp);
      action();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      pressed.delete(event.currentTarget);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      // Either order: the click can carry a time a hair before the lift's.
      const at = handledAt.get(event.currentTarget) ?? Number.NEGATIVE_INFINITY;
      if (event.detail > 0 && Math.abs(event.timeStamp - at) < CLICK_ECHO_MS) return;
      action();
    },
  };
}
