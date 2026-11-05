/**
 * Swipe a row away on Settings > Downloads (D369): a finger slides the row over a red strip with the
 * bin, as a queue row does (useRowSwipe.ts, player.css), ticking as it passes the point it leaves
 * from. Past the shared rule (lib/swipeAway.ts) the row stays out and the page asks before it
 * removes the copy; Cancel slides it back. A mouse keeps the row's ⋮. A hold still opens the sheet
 * (cardHold.ts): it fires only while the finger is inside its slop, which a swipe has left.
 */

import { AXIS_PX, SIDEWAYS_RATIO, SWIPE_SHARE, swipeLeaves } from "../lib/swipeAway";
import { createVelocityTracker, TAP_SLOP_PX } from "../player/core/gestureMath";

/** How long a row takes to slide home: --duration-press-out and a frame, as the queue's LEAVE_MS. */
const HOME_MS = 180;
/** How long after a swipe the row's own click does not open it. */
const SWIPE_CLICK_MS = 400;

interface Press {
  pointerId: number;
  card: HTMLElement;
  x0: number;
  y0: number;
  dx: number;
  felt: boolean;
  axis: "x" | "y" | null;
  mode: "idle" | "swipe" | "other";
}

/** A swipe's tick: the haptics are the player's, loaded on the first swipe. */
function feel(intent: "detent" | "tap"): void {
  void import("../player/sound/soundController").then(({ getHaptics }) =>
    getHaptics().fire(intent),
  );
}

/** Slides a swiped row back over its strip. */
export function restoreRow(card: HTMLElement): void {
  delete card.dataset.swiped;
  card.style.removeProperty("--swipe-x");
  // The strip shows until the row is home: past the row's own slide (--duration-press-out).
  window.setTimeout(() => {
    if (card.dataset.swiping === undefined && card.dataset.swiped === undefined)
      delete card.dataset.swipeDir;
  }, HOME_MS);
}

/**
 * Wires the swipe on the page's list. `ask` opens the confirm for the row that left; it slides the row
 * back itself when the answer is Cancel (restoreRow).
 */
export function installDownloadsSwipe(grid: HTMLElement, ask: (card: HTMLElement) => void): void {
  let press: Press | null = null;
  let swipedUntil = 0;
  const tracker = createVelocityTracker();

  grid.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.pointerType === "mouse") return;
    const card = (event.target as Element).closest<HTMLElement>("[data-card][data-downloaded]");
    // The cover's Play and the ⋮ have presses of their own.
    if (!card || (event.target as Element).closest(".card-menu, .cover-play")) return;
    press = {
      pointerId: event.pointerId,
      card,
      x0: event.clientX,
      y0: event.clientY,
      dx: 0,
      felt: false,
      axis: null,
      mode: "idle",
    };
    tracker.reset({ value: event.clientX, t: event.timeStamp });
  });

  grid.addEventListener("pointermove", (event) => {
    const current = press;
    if (!current || current.pointerId !== event.pointerId) return;
    // A hold opened the row's sheet: the press is the sheet's now.
    if (current.mode === "idle" && current.card.querySelector(":popover-open")) {
      press = null;
      return;
    }
    const dx = event.clientX - current.x0;
    const dy = event.clientY - current.y0;
    tracker.push(event.clientX, event.timeStamp);
    if (current.axis === null && Math.hypot(dx, dy) >= AXIS_PX)
      current.axis = Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_RATIO ? "x" : "y";
    if (current.mode === "idle") {
      if (current.axis === "y") current.mode = "other";
      else if (current.axis === "x" && Math.abs(dx) >= TAP_SLOP_PX) {
        current.mode = "swipe";
        current.card.setPointerCapture(event.pointerId);
        current.card.dataset.swiping = "";
      }
    }
    if (current.mode !== "swipe") return;
    current.dx = dx;
    current.card.dataset.swipeDir = dx < 0 ? "start" : "end";
    current.card.style.setProperty("--swipe-x", `${dx}px`);
    const past = Math.abs(dx) > current.card.offsetWidth * SWIPE_SHARE;
    if (past && !current.felt) feel("detent");
    current.felt = past;
  });

  const end = (event: PointerEvent): void => {
    const current = press;
    if (!current || current.pointerId !== event.pointerId) return;
    press = null;
    if (current.mode !== "swipe") return;
    const { card, dx } = current;
    delete card.dataset.swiping;
    swipedUntil = event.timeStamp + SWIPE_CLICK_MS;
    if (event.type !== "pointercancel" && swipeLeaves(dx, card.offsetWidth, tracker.velocity())) {
      if (!current.felt) feel("tap");
      card.dataset.swiped = "";
      card.style.setProperty("--swipe-x", `${Math.sign(dx) * card.offsetWidth * 1.2}px`);
      ask(card);
    } else restoreRow(card);
  };
  grid.addEventListener("pointerup", end);
  grid.addEventListener("pointercancel", end);

  // The click a swipe ends with does not open the row.
  grid.addEventListener(
    "click",
    (event) => {
      if (event.timeStamp < swipedUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  // A slanted thumb is not a scroll until the press has a direction (as the queue's list holds it,
  // useRowSwipe.ts: Chrome took the slant as a scroll and cancelled the press before the row moved).
  grid.addEventListener(
    "touchmove",
    (event) => {
      if (press && press.mode !== "other" && press.axis !== "y" && event.cancelable)
        event.preventDefault();
    },
    { passive: false },
  );
}
