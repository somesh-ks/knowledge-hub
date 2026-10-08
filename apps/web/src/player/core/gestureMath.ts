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
  /** Fraction of the travel, downward, that dismisses on a slow lift. */
  distance: number;
  /** px/ms downward that counts as a flick. */
  velocity: number;
}

/**
 * Travel inside this box is a tap, however fast it was. Fingers drift and thumbs drift more: an
 * 8 px slop swallowed real taps as cancelled swipes.
 */
export const TAP_SLOP_PX = 12;
/** A press held longer than this is not a tap. The browser's own click decides what it was. */
export const TAP_MAX_MS = 500;

/** `reachPx` is the furthest the pointer got from where it went down, on either axis. */
export function isTap(reachPx: number, durationMs: number): boolean {
  return reachPx <= TAP_SLOP_PX && durationMs <= TAP_MAX_MS;
}

/**
 * Opening asks for less than closing. A pull up the whole screen is a long way, and opening by
 * mistake costs nothing; closing by mistake takes the player away.
 */
export const OPEN_DISTANCE = 0.25;
/** px/ms upward that counts as a flick open. */
export const OPEN_VELOCITY = 0.4;
/** A finger still moving back at this speed has changed its mind. */
const REVERSING_VELOCITY = 0.1;

export interface ReleaseInput {
  /** This gesture's own travel since it took hold, in px. Positive is downward. */
  travelPx: number;
  /** px/ms at the lift. Positive is downward. */
  velocityPxPerMs: number;
  /** Pixels between collapsed and expanded. */
  distancePx: number;
  /** Whether the page was committed open when the gesture took hold. */
  originOpen: boolean;
  /** The system ended the gesture: a cancel, or capture lost without a lift. */
  cancelled: boolean;
}

/**
 * Where a lift sends the page: 1 to expanded, 0 to collapsed. The decision reads only what this
 * gesture did. How far up the page happens to be is not part of it, so catching a rising page
 * can never read as "dragged most of the way down".
 *
 * A flick wins. Otherwise far enough travel wins, unless the finger was coming back. Otherwise the
 * page returns to where it was headed before the finger arrived.
 */
export function decideRelease(input: ReleaseInput, thresholds: ReleaseThresholds): 0 | 1 {
  const origin = input.originOpen ? 1 : 0;
  if (input.cancelled || input.distancePx <= 0) return origin;
  const velocity = input.velocityPxPerMs;
  if (velocity > thresholds.velocity) return 0;
  if (velocity < -OPEN_VELOCITY) return 1;
  const fraction = input.travelPx / input.distancePx;
  if (fraction > thresholds.distance && velocity > -REVERSING_VELOCITY) return 0;
  if (fraction < -OPEN_DISTANCE && velocity < REVERSING_VELOCITY) return 1;
  return origin;
}

/**
 * The page follows the finger one to one, from the value it had when the finger took hold, and
 * stops at both ends: it is never pulled above fully open or below the bar.
 */
export function progressFromDrag(
  startProgress: number,
  travelPx: number,
  distancePx: number,
): number {
  if (distancePx <= 0) return startProgress;
  return clamp(startProgress - travelPx / distancePx, 0, 1);
}
