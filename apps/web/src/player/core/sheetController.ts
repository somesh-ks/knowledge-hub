/**
 * The player surface's motion, as a state machine.
 *
 * One number, `p`, runs from 0 (the bar, collapsed) to 1 (the page, expanded). A tap, the keyboard,
 * a pull up on the bar and a flick down on the page are four ways of moving `p`; each starts from
 * the live value and keeps velocity, so any of them can interrupt another without a jump.
 *
 *   collapsed -> dragging | expanding
 *   dragging  -> expanding | collapsing        (the lift decides, never the move)
 *   expanding -> expanded | dragging | collapsing
 *   expanded  -> dragging | collapsing
 *   collapsing -> collapsed | dragging | expanding
 *
 * Two things are kept apart on purpose. `state` is where the page is. `open` is whether the
 * listener has committed to it: it turns true the moment a tap or a lift decides to open, long
 * before the spring rests, and false the moment one decides to close. The rest of the document is
 * inert exactly while `open` is true, so the page behind is usable again as the page starts down.
 *
 * Rules that came out of the ways the old sheet got stuck:
 * - A lift decides on that gesture's own travel and velocity, never on how far the page has got.
 * - A tap while the page is moving turns it toward expanded. It never closes.
 * - Nothing here holds a DOM node. The view looks its elements up each time it is asked, so a
 *   navigation that rebuilds the document cannot leave the machine bound to nodes that are gone.
 *
 * Why not the View Transitions API for the page: a view transition cannot be driven by a finger,
 * cannot be interrupted, and freezes the page for its duration.
 */
import {
  createVelocityTracker,
  decideRelease,
  isTap,
  progressFromDrag,
  type ReleaseThresholds,
  TAP_SLOP_PX,
  velocityToProgressPerSecond,
} from "./gestureMath";
import { clamp } from "./mathUtils";
import { runSpring, runTween, SPRING_DURATION_SECONDS, type SpringRun } from "./spring";

export type SurfaceState = "collapsed" | "dragging" | "expanding" | "expanded" | "collapsing";

/** Where a pointer went down: on the bar's open button, on the page's drag zone, or on its body. */
export type GestureZone = "dock" | "drag" | "page";

export interface PointerInput {
  pointerId: number;
  x: number;
  y: number;
  /** Event time in milliseconds. */
  t: number;
  zone: GestureZone;
  /** False for a mouse, which has a wheel and never scrolls by dragging. */
  touch: boolean;
}

export interface SurfaceSnapshot {
  state: SurfaceState;
  /** The listener has committed to the page: the rest of the document is inert. */
  open: boolean;
  /** The page is close enough to its place that its controls take presses. */
  landed: boolean;
}

export interface SurfaceMetrics {
  /** Pixels between the page's collapsed and expanded positions. */
  distance: number;
}

/**
 * Everything the machine needs from the document. The real one is `surfaceView.ts`; the unit tests
 * pass a recorder.
 */
export interface SurfaceView {
  /** False when the surface is not in the document. Every motion is skipped then. */
  isPresent(): boolean;
  /** Reads layout. Called once each time the page leaves rest, never during motion. */
  measure(): SurfaceMetrics;
  /** Writes `p` for this frame. */
  render(p: number): void;
  /** Reflects the snapshot in attributes. */
  apply(snapshot: SurfaceSnapshot): void;
  /** Clears what motion left behind once the page is at rest. */
  rest(state: "collapsed" | "expanded"): void;
  enterModal(onEscape: () => void): void;
  leaveModal(): void;
  capturePointer(pointerId: number): void;
  releasePointer(pointerId: number): void;
  scrollTop(): number;
  scrollTo(top: number): void;
}

export interface SurfaceControllerOptions {
  view: SurfaceView;
  reducedMotion(): boolean;
  thresholds(): ReleaseThresholds;
  /** Length of the fade that replaces the spring under reduced motion. */
  fadeMs(): number;
  /** Bounce of the spring that follows an opening gesture. A close never bounces. */
  releaseBounce(): number;
  setRootAttribute(name: string, value: string): void;
  onCommitOpen?(): void;
  onCommitClose?(): void;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface SurfaceController {
  /** Opens along the spring. Safe at any time; while moving it retargets. */
  expand(): void;
  /** Closes along the quicker exit. Resolves when the page is at rest or the close is overtaken. */
  collapse(): Promise<void>;
  /** Closes in one step, without a sound. For navigations. */
  collapseNow(): void;
  /** The bar's own activation: opens, or closes a page that is fully open. */
  toggle(): void;
  pointerDown(input: PointerInput): void;
  pointerMove(input: PointerInput): void;
  /** A lift, or with `cancelled` a gesture the system took away (cancel, lost capture). */
  pointerEnd(input: PointerInput, cancelled: boolean): void;
  /** A click on the bar's open button. Drops the click that a handled gesture leaves behind. */
  click(event: { t: number; fromPointer: boolean }): void;
  /** Writes the current snapshot to the document again, for nodes that were rebuilt. */
  sync(): void;
  getSnapshot(): SurfaceSnapshot;
  getProgress(): number;
  subscribe(listener: () => void): () => void;
}

/** The exit is quicker than the entrance: the system gets out of the way. */
const CLOSE_SPEED_UP = 0.72;
/** From here on the page looks landed, so its controls should already answer. */
const LANDED_AT = 0.98;
/** A click this soon after a gesture the machine handled is that gesture's echo. */
const CLICK_ECHO_MS = 500;
/** The page counts as at the top within this, so a pixel of leftover scroll cannot block a dismissal. */
const AT_TOP_PX = 1;
/** Scroll carried past the lift decays with this time constant, as a native scroller's does. */
const COAST_TAU_MS = 325;
const COAST_MIN_PX_PER_MS = 0.02;
const COAST_MAX_PX_PER_MS = 4;

interface Gesture {
  pointerId: number;
  zone: GestureZone;
  touch: boolean;
  startX: number;
  startY: number;
  startT: number;
  /** Furthest the pointer got from the start on either axis, for telling a tap from a drag. */
  reach: number;
  mode: "pending" | "move" | "scroll" | "ignored";
  /** Where the drag took hold: the pointer's y and the value it began from. */
  anchorY: number;
  anchorValue: number;
  lastY: number;
  /** Whether the page was committed open when the drag took hold. */
  originOpen: boolean;
}

export function createSurfaceController(options: SurfaceControllerOptions): SurfaceController {
  const { view } = options;
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const tracker = createVelocityTracker();
  const listeners = new Set<() => void>();
  const waiters: Array<() => void> = [];

  let state: SurfaceState = "collapsed";
  let open = false;
  let landed = false;
  let p = 0;
  let distance = 0;
  let run: SpringRun | null = null;
  let gesture: Gesture | null = null;
  let handledAt = Number.NEGATIVE_INFINITY;
  let coasting = 0;

  const snapshot = (): SurfaceSnapshot => ({ state, open, landed });

  function publish(): void {
    view.apply(snapshot());
    for (const listener of listeners) listener();
  }

  function setState(next: SurfaceState): void {
    const nextLanded = next === "expanded" || (next === "expanding" && landed);
    if (state === next && landed === nextLanded) return;
    state = next;
    landed = nextLanded;
    publish();
  }

  function releaseWaiters(): void {
    for (const resolve of waiters.splice(0)) resolve();
  }

  function stopRun(): void {
    run?.stop();
    run = null;
  }

  function stopCoast(): void {
    if (coasting) cancelFrame(coasting);
    coasting = 0;
  }

  function paint(value: number): void {
    p = value;
    view.render(clamp(value, 0, 1));
  }

  /** Leaving rest: the one moment layout is read. */
  function leaveRest(): void {
    distance = view.measure().distance;
  }

  /* ---------------------------------------------------------------- commits */

  function commitOpen(): void {
    if (open) return;
    open = true;
    options.setRootAttribute("data-player", "open");
    publish();
    view.enterModal(() => {
      void collapse();
    });
    options.onCommitOpen?.();
  }

  function commitClose(silent = false): void {
    if (!open) return;
    open = false;
    options.setRootAttribute("data-player", "closed");
    // The document is given back before anyone is told, so a listener never sees a closed
    // player with the page behind it still inert.
    view.leaveModal();
    publish();
    if (!silent) options.onCommitClose?.();
  }

  /* ---------------------------------------------------------------- motion */

  function finish(target: 0 | 1): void {
    run = null;
    p = target;
    if (target === 1) {
      setState("expanded");
      view.rest("expanded");
      return;
    }
    setState("collapsed");
    view.rest("collapsed");
    releaseWaiters();
  }

  /** `velocity` is in progress per second; without one the motion under way hands its own on. */
  function settle(target: 0 | 1, kind: "settle" | "release", velocity?: number): void {
    const carried = velocity ?? run?.velocity() ?? 0;
    stopRun();
    if (target === 0) landed = false;
    setState(target === 1 ? "expanding" : "collapsing");
    const onUpdate = (value: number): void => {
      paint(value);
      if (target === 1 && !landed && value >= LANDED_AT) {
        landed = true;
        publish();
      }
    };
    const onRest = (): void => finish(target);
    if (options.reducedMotion()) {
      run = runTween({
        from: p,
        to: target,
        durationMs: options.fadeMs(),
        onUpdate,
        onRest,
        requestFrame,
        cancelFrame,
      });
      return;
    }
    run = runSpring({
      from: p,
      to: target,
      velocity: carried,
      spec: {
        duration: SPRING_DURATION_SECONDS[kind] * (target === 0 ? CLOSE_SPEED_UP : 1),
        // A close never bounces; an open bounces only when a gesture carried momentum into it.
        bounce: target === 1 && kind === "release" ? options.releaseBounce() : 0,
      },
      onUpdate,
      onRest,
      requestFrame,
      cancelFrame,
    });
  }

  /** A command (a key, a button) outranks a drag that is under way. */
  function dropGesture(): void {
    if (gesture?.mode === "move") view.releasePointer(gesture.pointerId);
    gesture = null;
  }

  function expand(): void {
    if (!view.isPresent()) return;
    dropGesture();
    if (state === "expanded" || state === "expanding") return;
    if (state === "collapsed") leaveRest();
    // A collapse that was being waited on has been overtaken.
    releaseWaiters();
    settle(1, "settle");
    commitOpen();
  }

  function collapse(): Promise<void> {
    if (state === "collapsed") return Promise.resolve();
    if (!view.isPresent()) {
      collapseNow();
      return Promise.resolve();
    }
    dropGesture();
    const done = new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    if (state === "collapsing") return done;
    if (state === "expanded") leaveRest();
    settle(0, "settle");
    commitClose();
    return done;
  }

  function collapseNow(): void {
    stopCoast();
    dropGesture();
    releaseWaiters();
    if (state === "collapsed" && !open) return;
    stopRun();
    landed = false;
    commitClose(true);
    p = 0;
    setState("collapsed");
    view.rest("collapsed");
  }

  function toggle(): void {
    if (state === "expanded") void collapse();
    else expand();
  }

  /* ---------------------------------------------------------------- gestures */

  /** The pointer has left the slop: decide what this drag is, once. */
  function takeHold(current: Gesture, input: PointerInput): void {
    const dy = input.y - current.startY;
    const atRestOpen = state === "expanded" || landed;
    // Anchored on the edge of the slop, so travel is the finger's own and nothing jumps.
    current.anchorY = current.startY + Math.sign(dy) * TAP_SLOP_PX;
    current.originOpen = open;
    tracker.reset({ value: current.anchorY, t: input.t });
    if (current.zone === "drag" && atRestOpen && (dy < 0 || view.scrollTop() > AT_TOP_PX)) {
      // Not a dismissal: the page scrolls under the finger, since the drag zone takes no native pan.
      current.mode = current.touch ? "scroll" : "ignored";
      current.anchorValue = view.scrollTop();
      return;
    }
    if (state === "collapsed" && dy > 0) {
      current.mode = "ignored";
      return;
    }
    if (state === "collapsed" || state === "expanded") leaveRest();
    stopRun();
    current.mode = "move";
    current.anchorValue = clamp(p, 0, 1);
    view.capturePointer(current.pointerId);
    landed = false;
    setState("dragging");
  }

  function pointerDown(input: PointerInput): void {
    if (gesture || !view.isPresent()) return;
    // On the open page the body belongs to its own controls and to native scrolling.
    if (input.zone === "page" && (state === "expanded" || landed)) return;
    if (input.zone !== "dock" && state === "collapsed") return;
    stopCoast();
    gesture = {
      pointerId: input.pointerId,
      zone: input.zone,
      touch: input.touch,
      startX: input.x,
      startY: input.y,
      startT: input.t,
      reach: 0,
      mode: "pending",
      anchorY: input.y,
      anchorValue: 0,
      lastY: input.y,
      originOpen: open,
    };
  }

  function pointerMove(input: PointerInput): void {
    const current = gesture;
    if (!current || input.pointerId !== current.pointerId) return;
    const dx = Math.abs(input.x - current.startX);
    const dy = input.y - current.startY;
    current.reach = Math.max(current.reach, dx, Math.abs(dy));
    if (current.mode === "pending") {
      // Vertical intent, past the slop. A sideways wander never takes hold.
      if (Math.abs(dy) <= TAP_SLOP_PX || Math.abs(dy) < dx) return;
      takeHold(current, input);
    }
    current.lastY = input.y;
    tracker.push(input.y, input.t);
    const travel = input.y - current.anchorY;
    if (current.mode === "move") paint(progressFromDrag(current.anchorValue, travel, distance));
    else if (current.mode === "scroll") view.scrollTo(current.anchorValue - travel);
  }

  /** Scroll that the finger let go of while moving runs on for a moment. */
  function coast(scrollVelocity: number): void {
    let speed = clamp(scrollVelocity, -COAST_MAX_PX_PER_MS, COAST_MAX_PX_PER_MS);
    let last: number | null = null;
    const step = (timestamp: number): void => {
      const dt = last === null ? 16 : Math.min(50, timestamp - last);
      last = timestamp;
      speed *= Math.exp(-dt / COAST_TAU_MS);
      const before = view.scrollTop();
      view.scrollTo(before + speed * dt);
      const stuck = view.scrollTop() === before;
      coasting = Math.abs(speed) < COAST_MIN_PX_PER_MS || stuck ? 0 : requestFrame(step);
    };
    coasting = requestFrame(step);
  }

  function pointerEnd(input: PointerInput, cancelled: boolean): void {
    const current = gesture;
    if (!current || input.pointerId !== current.pointerId) return;
    // Cleared first: the lost-capture event that follows a lift finds nothing to end.
    gesture = null;
    if (current.mode === "move") {
      view.releasePointer(current.pointerId);
      // The lift is a sample too: a finger that stopped before lifting has no velocity.
      tracker.push(input.y, input.t);
      const velocity = cancelled ? 0 : tracker.velocity();
      const target = decideRelease(
        {
          travelPx: current.lastY - current.anchorY,
          velocityPxPerMs: velocity,
          distancePx: distance,
          originOpen: current.originOpen,
          cancelled,
        },
        options.thresholds(),
      );
      handledAt = input.t;
      settle(target, "release", velocityToProgressPerSecond(velocity, distance));
      if (target === 1) commitOpen();
      else commitClose();
      return;
    }
    if (current.mode === "scroll") {
      handledAt = input.t;
      tracker.push(input.y, input.t);
      if (!cancelled) coast(-tracker.velocity());
      return;
    }
    if (current.mode === "ignored") {
      handledAt = input.t;
      return;
    }
    if (cancelled || !isTap(current.reach, input.t - current.startT)) return;
    if (current.zone === "dock") {
      handledAt = input.t;
      toggle();
      return;
    }
    // A tap on a page that is still moving turns it toward open. On the page at rest it belongs
    // to whatever was tapped, so it is not marked as handled.
    if (state === "expanding" || state === "collapsing") {
      handledAt = input.t;
      expand();
    }
  }

  function click(event: { t: number; fromPointer: boolean }): void {
    if (event.fromPointer && event.t - handledAt < CLICK_ECHO_MS && event.t >= handledAt) return;
    toggle();
  }

  return {
    expand,
    collapse,
    collapseNow,
    toggle,
    pointerDown,
    pointerMove,
    pointerEnd,
    click,
    sync() {
      // The root attribute as well: a page that never carried it gets it here.
      options.setRootAttribute("data-player", open ? "open" : "closed");
      view.apply(snapshot());
    },
    getSnapshot: snapshot,
    getProgress: () => clamp(p, 0, 1),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
