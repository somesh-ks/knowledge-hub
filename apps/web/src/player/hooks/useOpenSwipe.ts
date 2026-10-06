import { type RefObject, useEffect } from "react";
import { flushSync } from "react-dom";
import { createVelocityTracker } from "../core/gestureMath";
import { playerSheet } from "../core/playerSheet";
import { getExpandedPlayer, loadExpandedPlayer } from "../expandedPlayerLoader";

const DRAG_START_PX = 8;

function isWide(): boolean {
  return window.matchMedia("(min-width: 40rem)").matches;
}

/**
 * Swipe up on the mini player's open button opens the sheet interactively: it follows the finger,
 * amplified, and commits on velocity or distance when released. A tap still opens it through the
 * button's click. The button owns vertical pans (touch-action: none), so the page does not scroll
 * out from under the gesture.
 */
export function useOpenSwipe(ref: RefObject<HTMLElement | null>, mounted: boolean): void {
  useEffect(() => {
    // The bar renders nothing until a digest is loaded, so the element appears after the first
    // effect; `mounted` re-runs this when it does.
    const element = ref.current;
    if (!mounted || !element) return;
    const tracker = createVelocityTracker();
    let pointerId = -1;
    let startY = 0;
    let opening = false;
    let fallbackToTap = false;
    let suppressClick = false;

    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || pointerId !== -1) return;
      // Start fetching the sheet now, so the swipe or the tap lands on code that is ready.
      loadExpandedPlayer().catch(() => undefined);
      pointerId = event.pointerId;
      startY = event.clientY;
      opening = false;
      fallbackToTap = false;
      suppressClick = false;
      tracker.reset({ value: event.clientY, t: event.timeStamp });
      // Capture at the start so a mouse drag that leaves the bar keeps reporting. Touch captures
      // implicitly; this makes every pointer type behave the same.
      element.setPointerCapture(event.pointerId);
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      const dy = event.clientY - startY;
      if (!opening) {
        if (dy > -DRAG_START_PX || isWide()) return;
        suppressClick = true;
        if (!getExpandedPlayer()) {
          // The sheet's code has not arrived. Keep trying on the next move, and if the finger
          // lifts first, the swipe still opens the sheet, as a tap would.
          fallbackToTap = true;
          return;
        }
        // Mount the sheet synchronously, so its elements exist for this very move.
        flushSync(() => playerSheet.setPresence(true));
        if (!playerSheet.beginOpenDrag()) {
          playerSheet.setPresence(false);
          fallbackToTap = true;
          return;
        }
        fallbackToTap = false;
        opening = true;
        suppressClick = true;
      }
      tracker.push(event.clientY, event.timeStamp);
      playerSheet.updateOpenDrag(startY - event.clientY);
    };

    const onEnd = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
      if (opening) {
        opening = false;
        playerSheet.endOpenDrag(tracker.velocity(), event.type === "pointercancel");
      } else if (fallbackToTap && event.type !== "pointercancel") {
        playerSheet.open();
      }
    };

    /** The click that follows a swipe must not also open the sheet. */
    const onClick = (event: MouseEvent): void => {
      if (!suppressClick) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      suppressClick = false;
    };

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onEnd);
    element.addEventListener("pointercancel", onEnd);
    element.addEventListener("click", onClick, true);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onEnd);
      element.removeEventListener("pointercancel", onEnd);
      element.removeEventListener("click", onClick, true);
    };
  }, [ref, mounted]);
}
