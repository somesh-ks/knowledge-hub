/**
 * Playback volume, for screens with a pointer. A phone sets volume with its own buttons and ignores
 * a page that tries (iOS), so the control is only shown where it works.
 */
import { clamp } from "./mathUtils";
import { getPlayerAudio } from "./playerRuntime";
import { safeLocalStorage } from "./resume";

export const VOLUME_STORAGE_KEY = "dispatch:volume";

/** What a stored value means: a number from 0 to 1, or full volume when it is anything else. */
export function parseVolume(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 1;
  const value = Number(raw);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

export function getVolume(): number {
  try {
    return parseVolume(safeLocalStorage()?.getItem(VOLUME_STORAGE_KEY) ?? null);
  } catch {
    return 1;
  }
}

/** Puts the stored volume on the audio element. The element keeps it across every file it plays. */
export function applyVolume(volume: number = getVolume()): void {
  // The player's own audio type leaves volume out, since the store never touches it.
  const element = getPlayerAudio().element as unknown as { volume: number };
  element.volume = clamp(volume, 0, 1);
}

export function setVolume(volume: number): void {
  const next = clamp(volume, 0, 1);
  applyVolume(next);
  try {
    safeLocalStorage()?.setItem(VOLUME_STORAGE_KEY, String(next));
  } catch {
    // Not remembered, but applied: the listener still hears the change.
  }
}
