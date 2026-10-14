import { formatClock } from "./formatTime";
import { clamp } from "./mathUtils";

export function fractionOfTime(timeSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return clamp(timeSeconds / durationSeconds, 0, 1);
}

export const KEY_SEEK_SECONDS = 5;
export const KEY_SEEK_SHIFT_SECONDS = 15;

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
  // Before the first story (an episode's rundown) there is no story to name.
  if (itemCount === 0 || itemIndex < 0 || itemIndex >= itemCount) return base;
  const story = `story ${itemIndex + 1} of ${itemCount}`;
  return sectionTitle ? `${base}, ${story}, ${sectionTitle}` : `${base}, ${story}`;
}
