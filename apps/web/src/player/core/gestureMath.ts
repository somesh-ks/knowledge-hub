import { clamp } from "./mathUtils";

export interface Sample {
  /** Position along the gesture axis, in CSS pixels. */
  value: number;
  /** Event timestamp in milliseconds. */
  t: number;
}

/** Samples older than this stop describing what the finger is doing now. */
const VELOCITY_WINDOW_MS = 100;
const MAX_SAMPLES = 6;

/**
 * A short ring of recent positions. Release velocity comes from the last 100 ms only: averaging a
 * whole drag would report the slow start of a flick, and the sheet would spring back instead of
 * closing.
 */
export function createVelocityTracker(windowMs = VELOCITY_WINDOW_MS) {
  const samples: Sample[] = [];
  return {
    reset(first?: Sample): void {
      samples.length = 0;
      if (first) samples.push(first);
    },
    push(value: number, t: number): void {
      samples.push({ value, t });
      if (samples.length > MAX_SAMPLES) samples.shift();
    },
    /** Pixels per millisecond along the axis; positive is toward larger values. */
    velocity(): number {
      return estimateVelocity(samples, windowMs);
    },
  };
}

export function estimateVelocity(
  samples: readonly Sample[],
  windowMs = VELOCITY_WINDOW_MS,
): number {
  const last = samples.at(-1);
  if (!last) return 0;
  const first = samples.find((sample) => last.t - sample.t < windowMs) ?? samples[0];
  if (!first || last.t === first.t) return 0;
  return (last.value - first.value) / (last.t - first.t);
}

/** Converts a release velocity in px/ms to the spring's unit: progress per second. */
export function velocityToProgressPerSecond(pxPerMs: number, travelPx: number): number {
  if (travelPx <= 0) return 0;
  return (-pxPerMs * 1000) / travelPx;
}

export interface ReleaseThresholds {
  /** Fraction of the sheet's height travelled that counts as a decision. */
  distance: number;
  /** px/ms downward that counts as a flick. */
  velocity: number;
}

/**
 * Flick down: dismisses when the finger left fast, or when it travelled far and is not moving back
 * up. Release decides, never the move, so a dismissal can be abandoned by lifting early.
 */
export function shouldDismissOnRelease(
  travelledFraction: number,
  velocityPxPerMs: number,
  thresholds: ReleaseThresholds,
  cancelled: boolean,
): boolean {
  if (cancelled) return false;
  if (velocityPxPerMs > thresholds.velocity) return true;
  return travelledFraction > thresholds.distance && velocityPxPerMs > -0.1;
}

/** Swipe up on the mini player: a flick up, or past the distance threshold. */
export function shouldOpenOnRelease(
  progress: number,
  velocityPxPerMs: number,
  thresholds: ReleaseThresholds,
  cancelled: boolean,
): boolean {
  if (cancelled) return false;
  return velocityPxPerMs < -0.4 || progress > thresholds.distance;
}

/**
 * The finger travels less than the sheet: the whole height opens over three quarters of the
 * finger's travel, so the gesture feels eager without the sheet outrunning the touch.
 */
export const OPEN_GESTURE_AMPLIFICATION = 0.75;

export function openProgressFromDrag(dragUpPx: number, sheetHeightPx: number): number {
  if (sheetHeightPx <= 0) return 0;
  return clamp(dragUpPx / (sheetHeightPx * OPEN_GESTURE_AMPLIFICATION), 0, 1);
}

/** Dismiss drag follows the finger 1:1 and stops at fully open; it never pulls the sheet upward. */
export function dismissProgressFromDrag(
  startProgress: number,
  dragDownPx: number,
  sheetHeightPx: number,
): number {
  if (sheetHeightPx <= 0) return startProgress;
  return clamp(startProgress - dragDownPx / sheetHeightPx, 0, 1);
}
