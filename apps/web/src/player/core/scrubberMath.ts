import { formatClock } from "./formatTime";
import { clamp } from "./mathUtils";
import type { Timeline } from "./timeline";

/** Fraction 0 to 1 of the track under a pointer. A timeline is not text, so RTL does not flip it. */
export function fractionFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
): number {
  if (trackWidth <= 0) return 0;
  return clamp((clientX - trackLeft) / trackWidth, 0, 1);
}

export function timeFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  durationSeconds: number,
): number {
  return fractionFromPointer(clientX, trackLeft, trackWidth) * durationSeconds;
}

export function fractionOfTime(timeSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return clamp(timeSeconds / durationSeconds, 0, 1);
}

/**
 * A position on the device's pixel grid. Text moved by a fraction of a pixel is drawn afresh at a new
 * offset each frame, so the digits of a moving readout seem to shake; on whole device pixels they
 * keep one shape and only move.
 */
export function onPixelGrid(px: number, devicePixelRatio: number): number {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(px * ratio) / ratio;
}

/** Left edge of the bubble: centered on the thumb, clamped to stay inside the track. */
export function bubbleLeft(thumbX: number, bubbleWidth: number, trackWidth: number): number {
  const half = bubbleWidth / 2;
  if (trackWidth <= bubbleWidth) return 0;
  return clamp(thumbX, half, trackWidth - half) - half;
}

export type ScrubKeyAction =
  | { kind: "seek"; seconds: number }
  | { kind: "item"; direction: "next" | "previous" };

export const KEY_SEEK_SECONDS = 5;
export const KEY_SEEK_SHIFT_SECONDS = 15;

/**
 * The scrubber's keyboard map. Arrows seek 5 seconds (15 with Shift), the page keys move by item,
 * Home and End jump to the ends. Returns null for keys the slider does not own, so Tab and the
 * browser's shortcuts keep working.
 */
export function scrubKeyAction(
  key: string,
  shiftKey: boolean,
  timeSeconds: number,
  durationSeconds: number,
): ScrubKeyAction | null {
  const step = shiftKey ? KEY_SEEK_SHIFT_SECONDS : KEY_SEEK_SECONDS;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return { kind: "seek", seconds: Math.max(0, timeSeconds - step) };
    case "ArrowRight":
    case "ArrowUp":
      return { kind: "seek", seconds: Math.min(durationSeconds, timeSeconds + step) };
    case "PageDown":
      return { kind: "item", direction: "next" };
    case "PageUp":
      return { kind: "item", direction: "previous" };
    case "Home":
      return { kind: "seek", seconds: 0 };
    case "End":
      return { kind: "seek", seconds: durationSeconds };
    default:
      return null;
  }
}

/**
 * Where a key takes the bar's seek, which holds the exact time: in whole seconds, as the range did
 * when it stepped by one. An arrow moves one second from the whole second the playhead is in, a page
 * key a tenth of the length (a second at least), rounded to a whole second; Home and End go to 0
 * and to the last whole second. Null for a key the seek does not own.
 */
export function dockSeekKeyValue(
  key: string,
  timeSeconds: number,
  durationSeconds: number,
): number | null {
  const last = Math.max(0, Math.floor(durationSeconds));
  const now = clamp(Math.floor(timeSeconds), 0, last);
  const page = Math.max(last / 10, 1);
  let next: number;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      next = now + 1;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = now - 1;
      break;
    case "PageUp":
      next = now + page;
      break;
    case "PageDown":
      next = now - page;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return null;
  }
  return Math.round(clamp(next, 0, last));
}

/**
 * The start time of the boundary a scrub just crossed, or null when it stayed inside one item.
 * The boundary is the start of the later of the two items, whichever way the thumb moved.
 */
export function crossedBoundary(
  timeline: Timeline | null,
  fromItem: number,
  toItem: number,
): number | null {
  if (!timeline || fromItem === toItem) return null;
  return timeline.items[Math.max(fromItem, toItem)]?.startSec ?? null;
}

/**
 * One soft detent per boundary. Hovering a finger on a boundary would otherwise retrigger as
 * sensor noise moves the thumb back and forth, so a boundary within 2 percent of the digest length
 * of the last detent is ignored.
 */
export function shouldFireDetent(
  boundarySeconds: number,
  lastDetentSeconds: number | null,
  hysteresisFraction: number,
  durationSeconds: number,
): boolean {
  if (lastDetentSeconds === null) return true;
  return Math.abs(boundarySeconds - lastDetentSeconds) > hysteresisFraction * durationSeconds;
}

/**
 * A fast sweep across the track crosses many boundaries. Softer ticks at speed keep it a texture
 * instead of a rattle; a slow, deliberate drag gets the full detent.
 */
export function detentGain(pointerSpeedPxPerMs: number): number {
  const speed = Math.abs(pointerSpeedPxPerMs);
  return clamp(1 - (speed - 0.6) / 3, 0.4, 1);
}

export function scrubberValueText(
  timeSeconds: number,
  durationSeconds: number,
  sectionTitle: string,
  itemIndex: number,
  itemCount: number,
): string {
  const base = `${formatClock(timeSeconds)} of ${formatClock(durationSeconds)}`;
  if (itemCount === 0) return base;
  const story = `story ${itemIndex + 1} of ${itemCount}`;
  return sectionTitle ? `${base}, ${story}, ${sectionTitle}` : `${base}, ${story}`;
}
