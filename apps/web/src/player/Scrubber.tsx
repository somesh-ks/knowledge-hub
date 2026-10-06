import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { clockParts } from "./core/formatTime";
import { createVelocityTracker } from "./core/gestureMath";
import { getPlayerStore } from "./core/playerRuntime";
import {
  bubbleLeft,
  crossedBoundary,
  fractionOfTime,
  scrubberValueText,
  scrubKeyAction,
  shouldFireDetent,
  timeFromPointer,
} from "./core/scrubberMath";
import { itemPositionLabel } from "./core/timeline";
import { usePlayerFrame, usePlayerSecond, usePlayerState } from "./hooks/usePlayer";
import { playUiCue } from "./sound/soundController";
import { cueForDetent } from "./sound/soundMap";
import Clock from "./ui/Clock";

/**
 * The scrubber: a pointer-capture slider with a tick at every item start. It is the rail turned
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
      // The thumb is a zero-size anchor moved by transform; its disc is a pseudo-element, so its
      // press scale never multiplies the anchor's translation.
      if (thumbRef.current) {
        thumbRef.current.style.transform = `translate3d(${(fraction * widthRef.current).toFixed(2)}px, 0, 0)`;
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
      bubble.style.transform = `translate3d(${left.toFixed(1)}px, 0, 0)`;
    },
    [store, timeline],
  );

  usePlayerFrame((time, total) => {
    if (!drag.current.active) paint(time, total);
  });

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
    // A cancelled gesture (the system took the touch) puts the playhead back where it started.
    const target = event.type === "pointercancel" ? current.startTime : timeAt(event);
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
  const chapterStarts = new Set(timeline?.sections.map((entry) => entry.firstIndex));

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
          section?.title ?? "",
          state.itemIndex,
          itemCount,
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKeyDown}
      >
        <div className="scrubber-track">
          <span className="scrubber-fill" ref={fillRef} />
        </div>
        <div className="scrubber-ticks" aria-hidden="true">
          {timeline?.items.map((entry) => (
            <span
              key={entry.id}
              className="scrubber-tick"
              data-chapter={chapterStarts.has(entry.index) ? "" : undefined}
              data-played={entry.index <= state.itemIndex ? "" : undefined}
              style={
                {
                  "--tick-position": `${(fractionOfTime(entry.startSec, duration) * 100).toFixed(3)}%`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <span className="scrubber-thumb" ref={thumbRef} aria-hidden="true" />
        <div className="scrubber-bubble" ref={bubbleRef} aria-hidden="true">
          <span className="num scrubber-bubble-time">
            <span ref={bubbleMinutesRef}>0</span>
            <span className="player-colon">:</span>
            <span ref={bubbleSecondsRef}>00</span>
          </span>
          <span className="scrubber-bubble-item" ref={bubbleItemRef}>
            {itemPositionLabel(timeline, state.itemIndex)}
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
