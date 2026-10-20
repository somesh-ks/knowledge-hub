import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { longDateFromDigestId } from "./core/formatTime";
import {
  createVelocityTracker,
  decideRelease,
  isTap,
  progressFromDrag,
  TAP_SLOP_PX,
  velocityToProgressPerSecond,
} from "./core/gestureMath";
import { isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { runSpring, runTween, SPRING_DURATION_SECONDS, type SpringRun } from "./core/spring";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueueMeta } from "./hooks/useQueue";
import QueueList from "./QueueList";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/** As the player page's own dismissal: a flick or a third of the way decides it. */
const THRESHOLDS = { distance: 0.35, velocity: 0.5 } as const;
const SPEC = { duration: SPRING_DURATION_SECONDS.settle, bounce: 0 } as const;

interface Drag {
  pointerId: number;
  x0: number;
  y0: number;
  t0: number;
  q0: number;
  reach: number;
  active: boolean;
}

function surface(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-player-surface]");
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The strip's line: what plays next, by its title once its page has said. */
function NextTitle({ id }: { id: string }) {
  const meta = useQueueMeta(id);
  return <span className="player-queue-peek-title">{meta?.title ?? longDateFromDigestId(id)}</span>;
}

/**
 * The queue, as YouTube Music keeps it: a strip at the foot of the open player names what plays
 * next, and a pull up on it (or a press) raises the queue over the player. The playing recording
 * docks at the sheet's top, small, with its play button; a pull down on it (or a press, or Escape)
 * lowers the sheet again. One progress value, carried by the player's own spring and gesture maths,
 * moves the sheet (transform) and shrinks the cover out (transform and opacity); nothing else moves.
 */
export default function QueueSheet({ ids }: { ids: readonly string[] }) {
  const state = usePlayerState();
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [raised, setRaised] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLButtonElement>(null);
  const progress = useRef(0);
  const run = useRef<SpringRun | null>(null);
  const drag = useRef<Drag | null>(null);
  const tracker = useRef(createVelocityTracker());
  const swallowClick = useRef(false);

  useEffect(() => setStage(document.querySelector<HTMLElement>("[data-player-stage]")), []);

  function apply(q: number): void {
    progress.current = q;
    const root = surface();
    root?.style.setProperty("--queue-p", String(q));
    if (q > 0) root?.setAttribute("data-queue", "");
    else root?.removeAttribute("data-queue");
    // What the sheet covers takes no focus while it is up; the sheet takes none while it is down.
    root?.querySelector(".player-page-inner")?.toggleAttribute("inert", q >= 1);
    sheetRef.current?.toggleAttribute("inert", q <= 0);
  }

  function settle(target: 0 | 1): void {
    run.current = null;
    apply(target);
    setRaised(target === 1);
    if (target === 1) dockRef.current?.focus({ preventScroll: true });
    else if (sheetRef.current?.contains(document.activeElement) || !document.activeElement) {
      peekRef.current?.focus({ preventScroll: true });
    }
  }

  function moveTo(target: 0 | 1, velocity = 0): void {
    run.current?.stop();
    const from = progress.current;
    if (from === target) {
      settle(target);
      return;
    }
    const onUpdate = (value: number): void => apply(Math.min(1, Math.max(0, value)));
    const onRest = (): void => settle(target);
    run.current = reducedMotion()
      ? runTween({ from, to: target, durationMs: 150, onUpdate, onRest })
      : runSpring({ from, to: target, velocity, spec: SPEC, onUpdate, onRest });
  }

  // A player that closes takes the sheet down with it, at once. Leaving also puts the page back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: apply reads refs only; runs once.
  useEffect(() => {
    apply(0);
    const off = playerSheet.subscribe(() => {
      if (playerSheet.getSnapshot().open || progress.current === 0) return;
      run.current?.stop();
      run.current = null;
      apply(0);
      setRaised(false);
    });
    return () => {
      off();
      run.current?.stop();
      apply(0);
    };
  }, []);

  function distance(): number {
    return stage?.clientHeight ?? window.innerHeight;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || !event.isPrimary) return;
    // Ours, not the player page's dismissal.
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest("[data-queue-own]")) return;
    run.current?.stop();
    run.current = null;
    drag.current = {
      pointerId: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      t0: event.timeStamp,
      q0: progress.current,
      reach: 0,
      active: false,
    };
    tracker.current.reset({ value: event.clientY, t: event.timeStamp });
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = event.clientX - current.x0;
    const dy = event.clientY - current.y0;
    current.reach = Math.max(current.reach, Math.abs(dx), Math.abs(dy));
    if (!current.active) {
      if (current.reach <= TAP_SLOP_PX || Math.abs(dy) < Math.abs(dx)) return;
      // Anchored at the slop's edge, so the sheet does not jump by the slop as it takes hold.
      current.active = true;
      current.y0 += Math.sign(dy) * TAP_SLOP_PX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    tracker.current.push(event.clientY, event.timeStamp);
    apply(progressFromDrag(current.q0, event.clientY - current.y0, distance()));
  }

  function onPointerEnd(event: PointerEvent<HTMLElement>, cancelled: boolean): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (!current.active) return;
    // A drag is not also a press on what it started on.
    swallowClick.current = !isTap(current.reach, event.timeStamp - current.t0);
    const velocity = tracker.current.velocity();
    const target = decideRelease(
      {
        travelPx: event.clientY - current.y0,
        velocityPxPerMs: velocity,
        distancePx: distance(),
        originOpen: current.q0 > 0.5,
        cancelled,
      },
      THRESHOLDS,
    );
    moveTo(target, velocityToProgressPerSecond(velocity, distance()));
  }

  function press(target: 0 | 1): void {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    moveTo(target);
  }

  const gesture = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: PointerEvent<HTMLElement>) => onPointerEnd(event, false),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => onPointerEnd(event, true),
  };

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape" || !raised) return;
    // The sheet owns this Escape; the player stays open (modalScope.ts reads defaultPrevented).
    event.preventDefault();
    moveTo(0);
  }

  const digest = state.track?.digest;
  const [next] = ids;
  const sheet = (
    <section
      className="player-queue-sheet"
      ref={sheetRef}
      aria-labelledby="player-queue-title"
      inert
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="player-queue-head" {...gesture}>
        <button
          className="player-queue-dock"
          type="button"
          ref={dockRef}
          aria-label="Back to the player"
          onClick={() => press(0)}
        >
          <span className="player-queue-thumb">
            {digest ? (
              <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="thumb" />
            ) : null}
          </span>
          <span className="player-upnext-text">
            <span className="player-upnext-date">{digest?.title ?? ""}</span>
          </span>
        </button>
        <button
          className="icon-btn player-queue-toggle"
          type="button"
          data-queue-own
          data-playing={String(isPlayingStatus(state.status))}
          aria-label={toggleLabel(state)}
          onClick={() => getPlayerStore().toggle()}
        >
          <PlayPauseGlyph status={state.status} error={state.error} />
        </button>
      </div>
      <h3 className="player-section-title" id="player-queue-title">
        Up next
      </h3>
      <div className="player-queue-scroll">
        <QueueList ids={ids} />
      </div>
    </section>
  );

  return (
    <>
      {next ? (
        <button
          className="player-queue-peek"
          type="button"
          ref={peekRef}
          aria-expanded={raised}
          {...gesture}
          onClick={() => press(1)}
        >
          <span className="player-upnext-text">
            <span className="player-upnext-hint">Up next</span>
            <NextTitle id={next} />
          </span>
          <Icon name="chevronDown" className="player-queue-peek-glyph" />
        </button>
      ) : null}
      {stage ? createPortal(sheet, stage) : null}
    </>
  );
}
