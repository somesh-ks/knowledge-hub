import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { chapterMask } from "./core/chapterMask";
import { clockParts, clockSizerParts } from "./core/formatTime";
import { createVelocityTracker } from "./core/gestureMath";
import { getPlayerStore } from "./core/playerRuntime";
import {
  bubbleLeft,
  crossedBoundary,
  fractionOfTime,
  onPixelGrid,
  scrubberValueText,
  scrubKeyAction,
  shouldFireDetent,
  timeFromPointer,
} from "./core/scrubberMath";
import { itemPositionLabel, storySectionName } from "./core/timeline";
import { usePlayerFrame, usePlayerSecond, usePlayerState } from "./hooks/usePlayer";
import { playUiCue } from "./sound/soundController";
import { cueForDetent } from "./sound/soundMap";
import Clock from "./ui/Clock";

/**
 * The scrubber: a pointer-capture slider, cut into chapters at every item start as YouTube's is. It is the rail turned
 * horizontal, and the same playhead: moving one moves the other.
 *
 * - Pointer down anywhere on the 44px strip begins a scrub; the thumb jumps under the finger and
 *   follows it 1:1, even outside the strip (pointer capture).
 * - Narration pauses while the thumb is down and resumes on release. The seek happens on release.
 * - Crossing an item boundary fires one soft detent, softer at speed. Keys stay silent.
 * - The fill and the thumb are written straight to leaf elements; React renders once a second.
 */
export default function Scrubber() {
  const state = usePlayerState();
  const second = usePlayerSecond();
  const store = getPlayerStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const bubbleMinutesRef = useRef<HTMLSpanElement>(null);
  const bubbleSecondsRef = useRef<HTMLSpanElement>(null);
  const bubbleItemRef = useRef<HTMLSpanElement>(null);
  const widthRef = useRef(1);
  const drag = useRef({
    active: false,
    pointerId: -1,
    startTime: 0,
    lastItem: 0,
    lastDetentAt: null as number | null,
    hysteresis: 0.02,
    tracker: createVelocityTracker(),
  });

  const track = state.track;
  const timeline = track?.timeline ?? null;
  const duration = state.duration;

  const paint = useCallback(
    (time: number, total: number): void => {
      const fraction = fractionOfTime(time, total);
      fillRef.current?.style.setProperty("--player-progress", fraction.toFixed(5));
      // The thumb is a zero-size anchor moved by a custom property the stylesheet turns into a
      // transform; its disc is a pseudo-element, so its press scale never multiplies the anchor's
      // translation.
      if (thumbRef.current) {
        thumbRef.current.style.setProperty(
          "--thumb-x",
          `${(fraction * widthRef.current).toFixed(2)}px`,
        );
      }
      if (!drag.current.active) return;
      const bubble = bubbleRef.current;
      if (!bubble || !timeline) return;
      const { before, after } = clockParts(time);
      if (bubbleMinutesRef.current) bubbleMinutesRef.current.textContent = before;
      if (bubbleSecondsRef.current) bubbleSecondsRef.current.textContent = after;
      if (bubbleItemRef.current) {
        bubbleItemRef.current.textContent = itemPositionLabel(timeline, store.itemAt(time));
      }
      const left = bubbleLeft(fraction * widthRef.current, bubble.offsetWidth, widthRef.current);
      bubble.style.setProperty(
        "--bubble-x",
        `${onPixelGrid(left, window.devicePixelRatio).toFixed(3)}px`,
      );
    },
    [store, timeline],
  );

  usePlayerFrame((time, total) => {
    if (!drag.current.active) paint(time, total);
  });

  // If the scrubber goes away mid-drag (Escape closes the sheet under the finger), the store must
  // not stay in scrubbing, which would hold the playhead still for good.
  useEffect(
    () => () => {
      if (drag.current.active && store.getState().scrubbing) store.endScrub(drag.current.startTime);
    },
    [store],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = (): void => {
      widthRef.current = root.getBoundingClientRect().width || 1;
      paint(store.getTime(), store.getState().duration);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [store, paint]);

  function timeAt(event: { clientX: number }): number {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return timeFromPointer(event.clientX, rect.left, rect.width, store.getState().duration);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (event.button !== 0 || current.active || !timeline) return;
    current.active = true;
    current.pointerId = event.pointerId;
    current.startTime = store.getTime();
    current.lastDetentAt = null;
    current.hysteresis =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--scrubber-detent-hysteresis"),
      ) || 0.02;
    current.tracker.reset({ value: event.clientX, t: event.timeStamp });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = "true";
    store.beginScrub();
    const time = timeAt(event);
    current.lastItem = store.itemAt(time);
    store.scrubTo(time);
    paint(time, store.getState().duration);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current.active || event.pointerId !== current.pointerId) return;
    current.tracker.push(event.clientX, event.timeStamp);
    const time = timeAt(event);
    const item = store.itemAt(time);
    if (item !== current.lastItem) {
      const total = store.getState().duration;
      const boundary = crossedBoundary(timeline, current.lastItem, item);
      if (
        boundary !== null &&
        shouldFireDetent(boundary, current.lastDetentAt, current.hysteresis, total)
      ) {
        current.lastDetentAt = boundary;
        playUiCue(cueForDetent(fractionOfTime(boundary, total), current.tracker.velocity()));
      }
      current.lastItem = item;
    }
    store.scrubTo(time);
    paint(time, store.getState().duration);
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current;
    if (!current.active || event.pointerId !== current.pointerId) return;
    current.active = false;
    current.pointerId = -1;
    const root = event.currentTarget;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    delete root.dataset.dragging;
    // Only a lift seeks. A gesture that ended any other way (the system took the touch, the
    // capture was lost) puts the playhead back where it started.
    const target = event.type === "pointerup" ? timeAt(event) : current.startTime;
    store.endScrub(target);
    paint(target, store.getState().duration);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = scrubKeyAction(
      event.key,
      event.shiftKey,
      store.getTime(),
      store.getState().duration,
    );
    if (!action) return;
    event.preventDefault();
    if (action.kind === "seek") store.seekTo(action.seconds * 1000);
    else if (action.direction === "next") store.next("keyboard");
    else store.previous("keyboard");
  }

  if (!track) return null;

  const section = timeline?.sections[state.sectionIndex];
  const itemCount = timeline?.items.length ?? 0;
  const widest = clockSizerParts(duration);
  const mask = chapterMask(
    timeline?.items.map((entry) => fractionOfTime(entry.startSec, duration)) ?? [],
  );

  return (
    <div className="scrubber-wrap">
      <div
        ref={rootRef}
        className="scrubber"
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.min(second, Math.round(duration))}
        aria-valuetext={scrubberValueText(
          second,
          duration,
          storySectionName(state.track?.digest, section),
          state.itemIndex,
          itemCount,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={onKeyDown}
      >
        <div className="scrubber-track" style={{ "--chapter-mask": mask } as CSSProperties}>
          <span className="scrubber-fill" ref={fillRef} />
        </div>
        <span className="scrubber-thumb" ref={thumbRef} aria-hidden="true" />
        {/* Each line sits over a hidden copy of the widest it can get, so the bubble keeps one
            width for the whole drag and its digits do not jostle. */}
        <div className="scrubber-bubble" ref={bubbleRef} aria-hidden="true">
          <span className="num scrubber-bubble-time">
            <span>
              <span ref={bubbleMinutesRef}>0</span>
              <span className="player-colon">:</span>
              <span ref={bubbleSecondsRef}>00</span>
            </span>
            <span className="scrubber-bubble-sizer">
              {widest.before}
              <span className="player-colon">:</span>
              {widest.after}
            </span>
          </span>
          <span className="num scrubber-bubble-item">
            <span ref={bubbleItemRef}>{itemPositionLabel(timeline, state.itemIndex)}</span>
            <span className="scrubber-bubble-sizer">
              {itemPositionLabel(timeline, Math.max(0, itemCount - 1))}
            </span>
          </span>
        </div>
      </div>
      <div className="scrubber-times" aria-hidden="true">
        <Clock seconds={second} />
        <Clock seconds={Math.max(0, duration - second)} negative />
      </div>
    </div>
  );
}
