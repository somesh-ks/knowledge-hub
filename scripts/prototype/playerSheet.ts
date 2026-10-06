/**
 * The expanded player: a full-height sheet that follows the finger, shares its cover with the
 * mini player, and settles on a spring.
 *
 * One variable drives everything: p, the presentation progress from 0 (closed) to 1 (open).
 * - panel translateY = (1 - p) * height
 * - scrim opacity = p
 * - cover transform interpolates from the mini player's cover rect to its resting rect
 * Tap, keyboard, swipe up on the mini player and flick down all just move p, so every path is
 * interruptible and every handoff keeps velocity. Why not the View Transitions API for the cover:
 * it cannot be driven by a finger, cannot be interrupted, and freezes the page for its duration.
 * Reduced motion replaces the slide and the morph with a fade of p.
 */
import {
  clamp,
  lerp,
  prefersReducedMotion,
  readNumberToken,
  runSpring,
  runTween,
  type SpringRun,
  springFromTokens,
} from "./motion.js";

export interface PlayerSheetOptions {
  dialog: HTMLDialogElement;
  panel: HTMLElement;
  scrim: HTMLElement;
  /** Zone that starts a dismiss drag: handle, header, cover, title. */
  dragZone: HTMLElement;
  /** The cover inside the panel. */
  cover: HTMLElement;
  /** The mini player's cover, the other end of the shared element. */
  miniCover: () => HTMLElement | null;
  /** Element whose pointer-up-without-drag should open the sheet, and whose upward drag opens it. */
  openZone: HTMLElement;
  onCommitOpen: () => void;
  onCommitClose: () => void;
}

interface Sample {
  y: number;
  t: number;
}

const DRAG_START_PX = 8;

export function createPlayerSheet(options: PlayerSheetOptions) {
  const { dialog, panel, scrim, dragZone, cover, openZone } = options;
  let progress = 0;
  let run: SpringRun | null = null;
  let height = 0;
  let morph: { s0: number; dx: number; dy: number } | null = null;
  let isOpen = false;
  let suppressClick = false;
  let thumbRadius = 0;
  let largeRadius = 0;

  const wide = (): boolean => window.matchMedia("(min-width: 40rem)").matches;

  function render(p: number): void {
    progress = p;
    const visual = clamp(p, 0, 1);
    if (prefersReducedMotion()) {
      panel.style.transform = "none";
      panel.style.opacity = String(visual);
      scrim.style.opacity = String(visual);
      return;
    }
    if (wide()) {
      const scale = lerp(readNumberToken("--scale-enter"), 1, visual);
      panel.style.transform = `scale(${scale})`;
      panel.style.opacity = String(visual);
      scrim.style.opacity = String(visual);
      return;
    }
    panel.style.opacity = "";
    panel.style.transform = `translate3d(0, ${(1 - visual) * height}px, 0)`;
    scrim.style.opacity = String(visual);
    if (morph) {
      const s = lerp(morph.s0, 1, visual);
      cover.style.transform = `translate3d(${(1 - visual) * morph.dx}px, ${(1 - visual) * (morph.dy - height)}px, 0) scale(${s})`;
      // Scaling squeezes the corner radius, so the radius is divided by the scale to stay true.
      cover.style.setProperty("--cover-radius", `${lerp(thumbRadius, largeRadius, visual) / s}px`);
    }
  }

  function measure(): void {
    // Measure the resting layout: panel in place, cover untransformed.
    const previousTransform = panel.style.transform;
    const previousCover = cover.style.transform;
    panel.style.transform = "none";
    cover.style.transform = "none";
    cover.style.removeProperty("--cover-radius");
    height = panel.getBoundingClientRect().height;
    const final = cover.getBoundingClientRect();
    const mini = options.miniCover()?.getBoundingClientRect();
    morph =
      mini && !wide() && !prefersReducedMotion()
        ? { s0: mini.width / final.width, dx: mini.left - final.left, dy: mini.top - final.top }
        : null;
    thumbRadius = readNumberToken("--cover-radius-thumb") * 16;
    largeRadius = readNumberToken("--cover-radius-large") * 16;
    panel.style.transform = previousTransform;
    cover.style.transform = previousCover;
  }

  function stopRun(): void {
    run?.stop();
    run = null;
  }

  function settle(
    target: 0 | 1,
    velocity = 0,
    kind: "settle" | "release" = "settle",
    faster = false,
  ): Promise<void> {
    stopRun();
    return new Promise((resolve) => {
      const onRest = (): void => {
        run = null;
        if (target === 0) finishClose();
        resolve();
      };
      if (prefersReducedMotion()) {
        run = runTween({
          from: progress,
          to: target,
          ms: readNumberToken("--duration-state") || 200,
          onUpdate: render,
          onRest,
        });
        return;
      }
      const spec = springFromTokens(kind);
      run = runSpring({
        from: progress,
        to: target,
        velocity,
        spec: faster ? { ...spec, duration: spec.duration * 0.72 } : spec,
        onUpdate: render,
        onRest,
      });
    });
  }

  function finishClose(): void {
    isOpen = false;
    cover.style.transform = "";
    cover.style.removeProperty("--cover-radius");
    panel.style.transform = "";
    panel.style.opacity = "";
    document.documentElement.dataset.player = "closed";
    if (dialog.open) dialog.close();
  }

  function begin(): void {
    stopRun();
    if (!dialog.open) dialog.showModal();
    document.documentElement.dataset.player = "open";
    measure();
    render(progress);
    isOpen = true;
  }

  function open(velocity = 0, fromGesture = false): void {
    if (!dialog.open) {
      progress = 0;
      begin();
    }
    options.onCommitOpen();
    void settle(1, velocity, fromGesture ? "release" : "settle");
  }

  function close(velocity = 0, fromGesture = false): void {
    if (!dialog.open) return;
    options.onCommitClose();
    void settle(0, velocity, fromGesture ? "release" : "settle", true);
  }

  /* ---- drag to dismiss, from the drag zone */

  let dragging = false;
  let startY = 0;
  let startProgress = 1;
  let samples: Sample[] = [];
  let activeId = -1;

  const velocityPxPerMs = (): number => {
    const last = samples.at(-1);
    const first = samples.find((sample) => last && last.t - sample.t < 100) ?? samples[0];
    if (!last || !first || last.t === first.t) return 0;
    return (last.y - first.y) / (last.t - first.t);
  };

  dragZone.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || dragging || wide()) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    dragging = true;
    activeId = event.pointerId;
    startY = event.clientY;
    startProgress = progress;
    samples = [{ y: event.clientY, t: event.timeStamp }];
    dragZone.setPointerCapture(event.pointerId);
    stopRun();
  });

  dragZone.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activeId) return;
    const dy = event.clientY - startY;
    if (Math.abs(dy) < DRAG_START_PX && startProgress === progress) return;
    samples.push({ y: event.clientY, t: event.timeStamp });
    if (samples.length > 6) samples.shift();
    // Downward drags follow the finger 1:1; upward drags stop at fully open.
    render(clamp(startProgress - dy / height, 0, 1));
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== activeId) return;
    dragging = false;
    if (dragZone.hasPointerCapture(event.pointerId))
      dragZone.releasePointerCapture(event.pointerId);
    const velocity = velocityPxPerMs();
    const travelled = 1 - progress;
    const dismissDistance = readNumberToken("--player-dismiss-distance");
    const dismissVelocity = readNumberToken("--player-dismiss-velocity");
    // Release decides, never the move: dismissal is destructive-ish, so it waits for the lift.
    if (
      event.type !== "pointercancel" &&
      (velocity > dismissVelocity || (travelled > dismissDistance && velocity > -0.1))
    ) {
      close((-velocity * 1000) / height, true);
    } else {
      void settle(1, (-velocity * 1000) / height, "release");
    }
  };
  dragZone.addEventListener("pointerup", endDrag);
  dragZone.addEventListener("pointercancel", endDrag);

  /* ---- swipe up, or tap, on the mini player */

  let opening = false;
  let openId = -1;
  let openStartY = 0;
  let openSamples: Sample[] = [];

  openZone.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || wide()) return;
    opening = false;
    openId = event.pointerId;
    openStartY = event.clientY;
    openSamples = [{ y: event.clientY, t: event.timeStamp }];
    suppressClick = false;
    // Capture at the start so a mouse drag that leaves the bar keeps reporting. Touch captures
    // implicitly; this makes every pointer type behave the same.
    openZone.setPointerCapture(event.pointerId);
  });

  openZone.addEventListener("pointermove", (event) => {
    if (event.pointerId !== openId || event.buttons === 0) return;
    const dy = event.clientY - openStartY;
    if (!opening) {
      if (dy > -DRAG_START_PX) return;
      opening = true;
      suppressClick = true;
      progress = 0;
      begin();
    }
    openSamples.push({ y: event.clientY, t: event.timeStamp });
    if (openSamples.length > 6) openSamples.shift();
    // Amplified so the whole sheet rises over three quarters of its height of finger travel.
    render(clamp(-dy / (height * 0.75), 0, 1));
  });

  const endOpen = (event: PointerEvent): void => {
    if (event.pointerId !== openId) return;
    openId = -1;
    if (openZone.hasPointerCapture(event.pointerId))
      openZone.releasePointerCapture(event.pointerId);
    if (!opening) return;
    opening = false;
    const last = openSamples.at(-1);
    const first = openSamples.find((sample) => last && last.t - sample.t < 100) ?? openSamples[0];
    const velocity =
      last && first && last.t !== first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    if (
      event.type !== "pointercancel" &&
      (velocity < -0.4 || progress > readNumberToken("--player-dismiss-distance"))
    ) {
      options.onCommitOpen();
      void settle(1, (-velocity * 1000) / height, "release");
    } else {
      // A cancelled swipe is not a commit, so it makes no sound.
      void settle(0, (-velocity * 1000) / height, "release", true);
    }
  };
  openZone.addEventListener("pointerup", endOpen);
  openZone.addEventListener("pointercancel", endOpen);

  /** The click after a swipe must not also open the sheet. */
  openZone.addEventListener(
    "click",
    (event) => {
      if (suppressClick) {
        event.stopImmediatePropagation();
        event.preventDefault();
        suppressClick = false;
      }
    },
    true,
  );

  /* ---- scrim, escape */

  scrim.addEventListener("pointerdown", () => close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });

  return {
    open: () => open(),
    close: () => close(),
    isOpen: () => isOpen,
  };
}
