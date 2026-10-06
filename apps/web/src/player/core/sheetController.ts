/**
 * The expanded player's motion: one variable, `p`, from 0 (closed) to 1 (open), drives the panel,
 * the scrim and the cover. Tap, keyboard, swipe up on the mini player and flick down are four
 * ways of moving `p`; each starts from the live value and keeps velocity, so any of them can be
 * interrupted by another without a jump.
 *
 * Why not the View Transitions API for the cover: a view transition cannot be driven by a finger,
 * cannot be interrupted, and freezes the page for its duration. Swipe up is a requirement, so the
 * same FLIP interpolation serves tap too: one path, no fallback.
 *
 * Why not Base UI Drawer's own swipe: it exposes progress only as CSS variables and animates open
 * and close with CSS transitions, so there is no per-frame value to interpolate a cover rectangle
 * with. Base UI still provides the dialog semantics, focus trap, inert background and scroll lock;
 * this controller owns the motion and the Drawer stays open until the exit spring comes to rest.
 *
 * Style writes here are computed per frame (transform, opacity, one custom property), which is the
 * one place inline styles are right: they cannot live in a stylesheet.
 */
import { type CoverMorph, computeMorph, coverFrame, coverRadius, panelOffset } from "./coverMorph";
import {
  createVelocityTracker,
  dismissProgressFromDrag,
  openProgressFromDrag,
  shouldDismissOnRelease,
  shouldOpenOnRelease,
  velocityToProgressPerSecond,
} from "./gestureMath";
import { clamp, lerp } from "./mathUtils";
import { setRootAttribute } from "./rootAttributes";
import { runSpring, runTween, SPRING_DURATION_SECONDS, type SpringRun } from "./spring";

export interface SheetBindings {
  panel: HTMLElement;
  scrim: HTMLElement;
  /** Starts a dismiss drag: handle, header, cover, title. */
  dragZone: HTMLElement;
  /** The cover inside the panel, the other end of the shared element. */
  cover: HTMLElement | null;
}

export interface SheetControllerOptions {
  onCommitOpen?: () => void;
  onCommitClose?: () => void;
}

export interface PlayerSheetController {
  attach(bindings: SheetBindings): () => void;
  /** Presents the sheet from closed along the spring. Safe to call while it is already moving. */
  open(): void;
  /** Dismisses along the quicker exit. */
  close(): void;
  /** Starts a swipe-up. Returns false when the sheet is not mounted yet. */
  beginOpenDrag(): boolean;
  updateOpenDrag(dragUpPx: number): void;
  endOpenDrag(velocityPxPerMs: number, cancelled: boolean): void;
  isAttached(): boolean;
  getProgress(): number;
  subscribePresence(listener: () => void): () => void;
  /** Whether the Drawer should be mounted. It stays true until the exit spring rests. */
  getPresence(): boolean;
  setPresence(present: boolean): void;
}

const DRAG_START_PX = 8;
/** The exit is quicker than the entrance: the system gets out of the way. */
const CLOSE_SPEED_UP = 0.72;
const REDUCED_FADE_FALLBACK_MS = 200;

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readNumberToken(name: string): number {
  return Number.parseFloat(readToken(name));
}

function readMillisecondsToken(name: string): number {
  const raw = readToken(name);
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return REDUCED_FADE_FALLBACK_MS;
  return raw.endsWith("ms") ? value : value * 1000;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The breakpoint token is the one source for where the player becomes a centered card. */
function isWide(): boolean {
  return window.matchMedia(`(min-width: ${readToken("--breakpoint-wide") || "40rem"})`).matches;
}

export function createPlayerSheetController(
  options: SheetControllerOptions = {},
): PlayerSheetController {
  let bindings: SheetBindings | null = null;
  let detachListeners: (() => void) | null = null;
  let progress = 0;
  let run: SpringRun | null = null;
  let height = 0;
  let morph: CoverMorph | null = null;
  let thumbRadius = 0;
  let restingRadius = 0;
  let pendingOpen = false;
  let present = false;
  const presenceListeners = new Set<() => void>();

  /* ------------------------------------------------------------------ presence */

  function setPresence(next: boolean): void {
    if (present === next) return;
    present = next;
    for (const listener of presenceListeners) listener();
  }

  /* ------------------------------------------------------------------ rendering */

  function render(p: number): void {
    if (!bindings) return;
    progress = p;
    const { panel, scrim, cover } = bindings;
    const visual = clamp(p, 0, 1);
    scrim.style.opacity = String(visual);
    if (prefersReducedMotion()) {
      // Fewer and gentler, not zero: the slide and the morph become a fade of p.
      panel.style.transform = "none";
      panel.style.opacity = String(visual);
      return;
    }
    if (isWide()) {
      const scale = lerp(readNumberToken("--scale-enter") || 0.96, 1, visual);
      panel.style.transform = `scale(${scale})`;
      panel.style.opacity = String(visual);
      return;
    }
    panel.style.opacity = "";
    panel.style.transform = `translate3d(0, ${panelOffset(p, height)}px, 0)`;
    if (cover && morph) {
      const frame = coverFrame(p, morph, height);
      cover.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0) scale(${frame.scale})`;
      cover.style.setProperty(
        "--cover-radius",
        `${coverRadius(p, thumbRadius, restingRadius, frame.scale)}px`,
      );
    }
  }

  /** First and Last of the FLIP: measured once per motion, with the panel at rest. */
  function measure(): void {
    if (!bindings) return;
    const { panel, cover } = bindings;
    const previousPanel = panel.style.transform;
    const previousCover = cover?.style.transform ?? "";
    panel.style.transform = "none";
    if (cover) {
      cover.style.transform = "none";
      cover.style.removeProperty("--cover-radius");
    }
    height = panel.getBoundingClientRect().height;
    const miniCover = document.querySelector<HTMLElement>("[data-mini-cover]");
    morph =
      cover && miniCover && !isWide() && !prefersReducedMotion()
        ? computeMorph(miniCover.getBoundingClientRect(), cover.getBoundingClientRect())
        : null;
    if (cover && miniCover) {
      restingRadius = Number.parseFloat(getComputedStyle(cover).borderTopLeftRadius) || 0;
      thumbRadius = Number.parseFloat(getComputedStyle(miniCover).borderTopLeftRadius) || 0;
    }
    panel.style.transform = previousPanel;
    if (cover) cover.style.transform = previousCover;
  }

  /* ------------------------------------------------------------------ motion */

  function stopRun(): void {
    run?.stop();
    run = null;
  }

  function finishClose(): void {
    stopRun();
    if (bindings) {
      const { panel, scrim, cover } = bindings;
      panel.style.transform = "";
      panel.style.opacity = "";
      scrim.style.opacity = "";
      delete panel.dataset.moving;
      if (cover) {
        cover.style.transform = "";
        cover.style.removeProperty("--cover-radius");
      }
    }
    progress = 0;
    setRootAttribute("data-player", "closed");
    setPresence(false);
  }

  function settle(target: 0 | 1, velocity = 0, kind: "settle" | "release" = "settle"): void {
    stopRun();
    if (!bindings) return;
    bindings.panel.dataset.moving = "";
    const onRest = (): void => {
      run = null;
      if (target === 0) finishClose();
      else if (bindings) delete bindings.panel.dataset.moving;
    };
    if (prefersReducedMotion()) {
      run = runTween({
        from: progress,
        to: target,
        durationMs: readMillisecondsToken("--duration-state"),
        onUpdate: render,
        onRest,
      });
      return;
    }
    const durationSeconds = SPRING_DURATION_SECONDS[kind] * (target === 0 ? CLOSE_SPEED_UP : 1);
    run = runSpring({
      from: progress,
      to: target,
      velocity,
      spec: { duration: durationSeconds, bounce: readNumberToken(`--spring-${kind}-bounce`) || 0 },
      onUpdate: render,
      onRest,
    });
  }

  function begin(): void {
    stopRun();
    setRootAttribute("data-player", "open");
    if (bindings) bindings.panel.dataset.moving = "";
    measure();
    render(progress);
  }

  function open(): void {
    if (!bindings) {
      pendingOpen = true;
      setPresence(true);
      return;
    }
    if (progress === 0) begin();
    options.onCommitOpen?.();
    settle(1, 0, "settle");
  }

  function close(velocity = 0, fromGesture = false): void {
    if (!bindings) {
      pendingOpen = false;
      setPresence(false);
      return;
    }
    options.onCommitClose?.();
    settle(0, velocity, fromGesture ? "release" : "settle");
  }

  /* ------------------------------------------------------------------ swipe up to open */

  function beginOpenDrag(): boolean {
    if (!bindings || isWide()) return false;
    progress = 0;
    begin();
    return true;
  }

  function updateOpenDrag(dragUpPx: number): void {
    render(openProgressFromDrag(dragUpPx, height));
  }

  function endOpenDrag(velocityPxPerMs: number, cancelled: boolean): void {
    const thresholds = {
      distance: readNumberToken("--player-dismiss-distance") || 0.35,
      velocity: readNumberToken("--player-dismiss-velocity") || 0.5,
    };
    if (shouldOpenOnRelease(progress, velocityPxPerMs, thresholds, cancelled)) {
      options.onCommitOpen?.();
      settle(1, velocityToProgressPerSecond(velocityPxPerMs, height), "release");
    } else {
      // A cancelled swipe is not a commit, so it makes no sound.
      settle(0, velocityToProgressPerSecond(velocityPxPerMs, height), "release");
    }
  }

  /* ------------------------------------------------------------------ flick down to dismiss */

  function bindDismissDrag(zone: HTMLElement): () => void {
    const tracker = createVelocityTracker();
    let dragging = false;
    let activeId = -1;
    let startY = 0;
    let startProgress = 1;

    const onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || dragging || isWide()) return;
      if ((event.target as Element).closest("button, a, input")) return;
      dragging = true;
      activeId = event.pointerId;
      startY = event.clientY;
      startProgress = progress;
      tracker.reset({ value: event.clientY, t: event.timeStamp });
      zone.setPointerCapture(event.pointerId);
      stopRun();
    };

    const onMove = (event: PointerEvent): void => {
      if (!dragging || event.pointerId !== activeId) return;
      const dy = event.clientY - startY;
      // An 8px dead zone keeps a tap from nudging the sheet.
      if (Math.abs(dy) < DRAG_START_PX && startProgress === progress) return;
      tracker.push(event.clientY, event.timeStamp);
      if (bindings) bindings.panel.dataset.moving = "";
      render(dismissProgressFromDrag(startProgress, dy, height));
    };

    const onEnd = (event: PointerEvent): void => {
      if (!dragging || event.pointerId !== activeId) return;
      dragging = false;
      if (zone.hasPointerCapture(event.pointerId)) zone.releasePointerCapture(event.pointerId);
      const velocity = tracker.velocity();
      const thresholds = {
        distance: readNumberToken("--player-dismiss-distance") || 0.35,
        velocity: readNumberToken("--player-dismiss-velocity") || 0.5,
      };
      // Release decides, never the move: dismissal waits for the lift, so a drag can be abandoned.
      const dismiss = shouldDismissOnRelease(
        1 - progress,
        velocity,
        thresholds,
        event.type === "pointercancel",
      );
      const progressVelocity = velocityToProgressPerSecond(velocity, height);
      if (dismiss) close(progressVelocity, true);
      else settle(1, progressVelocity, "release");
    };

    zone.addEventListener("pointerdown", onDown);
    zone.addEventListener("pointermove", onMove);
    zone.addEventListener("pointerup", onEnd);
    zone.addEventListener("pointercancel", onEnd);
    return () => {
      zone.removeEventListener("pointerdown", onDown);
      zone.removeEventListener("pointermove", onMove);
      zone.removeEventListener("pointerup", onEnd);
      zone.removeEventListener("pointercancel", onEnd);
    };
  }

  /* ------------------------------------------------------------------ mounting */

  function attach(next: SheetBindings): () => void {
    bindings = next;
    detachListeners = bindDismissDrag(next.dragZone);
    measure();
    render(progress);
    if (pendingOpen) {
      pendingOpen = false;
      begin();
      options.onCommitOpen?.();
      settle(1, 0, "settle");
    }
    return () => {
      stopRun();
      detachListeners?.();
      detachListeners = null;
      if (bindings === next) bindings = null;
      progress = 0;
      setRootAttribute("data-player", "closed");
    };
  }

  return {
    attach,
    open,
    close: () => close(),
    beginOpenDrag,
    updateOpenDrag,
    endOpenDrag,
    isAttached: () => bindings !== null,
    getProgress: () => progress,
    subscribePresence(listener) {
      presenceListeners.add(listener);
      return () => presenceListeners.delete(listener);
    },
    getPresence: () => present,
    setPresence,
  };
}
