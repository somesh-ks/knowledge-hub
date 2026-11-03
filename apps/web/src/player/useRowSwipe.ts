import { type PointerEvent, useRef } from "react";
import { SWIPE_SHARE, swipeLeaves } from "../lib/swipeAway";
import { createVelocityTracker, TAP_SLOP_PX } from "./core/gestureMath";
import { getPlayQueue } from "./core/playerRuntime";
import { getHaptics } from "./sound/soundController";

/** How long a row slides out before the queue drops it: --duration-press-out and a frame. */
const LEAVE_MS = 180;
/** How long after a swipe the row's own click is not a play. */
const SWIPE_CLICK_MS = 400;

/** The part of the row that slides: the red strip behind it stays where it is. */
function faceOf(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>(".player-queue-face") ?? row;
}

interface Press {
  pointerId: number;
  row: HTMLElement;
  id: string;
  x0: number;
  y0: number;
  dx: number;
  /** True once the row has been felt to pass the point where it would leave. */
  felt: boolean;
  /** Undecided, a sideways swipe of ours, or a press the browser owns (a scroll or a drag). */
  mode: "idle" | "swipe" | "other";
}

/**
 * A queue row's sideways swipe, shared by the rows to come and the ones that played or play now: past
 * the tap slop the row follows the finger over a red strip with a bin (player.css, data-swipe-dir),
 * ticking as it passes the point it leaves from (a flick ticks on release), and on release the shared rule (lib/swipeAway.ts) says whether it takes the row off the list or the
 * row springs back. Either side takes it away.
 */
export function useRowSwipe() {
  const press = useRef<Press | null>(null);
  const swipedUntil = useRef(0);
  const tracker = useRef(createVelocityTracker());
  return {
    onPointerDown(event: PointerEvent<HTMLElement>, id: string): void {
      if (!event.isPrimary || event.button !== 0) return;
      // The handle has presses of its own.
      if (
        (event.target as Element).closest(
          ".player-queue-grip, .player-queue-more, .player-queue-menu",
        )
      )
        return;
      press.current = {
        pointerId: event.pointerId,
        row: event.currentTarget,
        id,
        x0: event.clientX,
        y0: event.clientY,
        dx: 0,
        felt: false,
        mode: "idle",
      };
      tracker.current.reset({ value: event.clientX, t: event.timeStamp });
    },
    onPointerMove(event: PointerEvent<HTMLElement>): void {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.x0;
      const dy = event.clientY - current.y0;
      tracker.current.push(event.clientX, event.timeStamp);
      if (current.mode === "idle") {
        if (Math.abs(dx) >= TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
          current.mode = "swipe";
          current.row.setPointerCapture(event.pointerId);
          current.row.dataset.swiping = "";
        } else if (Math.abs(dy) >= TAP_SLOP_PX) current.mode = "other";
      }
      if (current.mode !== "swipe") return;
      // Ours, not the player page's own pull.
      event.stopPropagation();
      current.dx = dx;
      current.row.dataset.swipeDir = dx < 0 ? "start" : "end";
      faceOf(current.row).style.translate = `${dx}px 0`;
      // A tick as the row passes the point it would leave from, again if it is pulled back and over.
      const past = Math.abs(dx) > current.row.offsetWidth * SWIPE_SHARE;
      if (past && !current.felt) getHaptics().fire("detent");
      current.felt = past;
    },
    onPointerEnd(event: PointerEvent<HTMLElement>): void {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      press.current = null;
      if (current.mode !== "swipe") return;
      event.stopPropagation();
      const { row, dx, id } = current;
      delete row.dataset.swiping;
      swipedUntil.current = event.timeStamp + SWIPE_CLICK_MS;
      if (
        event.type !== "pointercancel" &&
        swipeLeaves(dx, row.offsetWidth, tracker.current.velocity())
      ) {
        row.dataset.leaving = "";
        // A flick that never passed the point has not been felt yet.
        if (!current.felt) getHaptics().fire("tap");
        faceOf(row).style.translate = `${Math.sign(dx) * row.offsetWidth * 1.2}px 0`;
        window.setTimeout(() => getPlayQueue().remove(id), LEAVE_MS);
      } else {
        faceOf(row).style.translate = "";
        delete row.dataset.swipeDir;
      }
    },
    /** True just after a swipe, so the row's click does not play what the finger meant to move. */
    swiped: (): boolean => performance.now() < swipedUntil.current,
  };
}
