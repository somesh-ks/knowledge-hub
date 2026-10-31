/**
 * Which event makes which sound. This file is the whole of sound-design.md's map in one place, as
 * pure functions, so a test can assert it against a fake engine and the UI stays complete without
 * any of it.
 *
 * Rules that shaped it: frequency decides weight (nothing for scrolling, links, hover, theme
 * changes or keyboard navigation), every sound has a visual twin, and narration is sacred (the
 * engine skips or ducks per recipe; this layer only chooses names).
 */
import type { PlayOptions, SoundName } from "@singularity/sound";
import type { HapticIntent } from "../../design-system/hapticTokens";
import type { PlayerEvent } from "../core/playerTypes";
import { detentGain } from "../core/scrubberMath";

export interface Cue {
  name: SoundName;
  options?: PlayOptions;
  /** What the same action feels like (D273). Absent: nothing, as transport and the volume sample. */
  haptic?: HapticIntent;
}

/** The minimal engine surface the mapping needs, so tests inject a fake. */
export interface CueSink {
  play(name: SoundName, options?: PlayOptions): boolean;
}

export function cueForPlayerEvent(event: PlayerEvent): Cue | null {
  switch (event.type) {
    case "willPlay":
      // A scrub's own resume is the same narration continuing, not a new start.
      return event.reason === "scrub" ? null : { name: "play" };
    case "didPause":
      // The system and scrubbing pause narration without the listener pressing pause.
      return event.reason === "user" ? { name: "pause" } : null;
    case "itemChanged":
      if (event.cause === "skip-next") return { name: "itemNext" };
      if (event.cause === "skip-previous") return { name: "itemPrev" };
      // Keyboard navigation, automatic advance, scrubbing and chapter taps stay silent.
      return null;
    case "rateChanged":
      return { name: "speedChange", options: { rate: event.rate } };
    case "ended":
      return { name: "digestEnd" };
    case "error":
      return { name: "error" };
    case "interrupted":
    case "loaded":
      return null;
  }
}

/** A scrub crossing an item boundary: one detent, pitched by position, softer when fast. */
export function cueForDetent(position: number, pointerSpeedPxPerMs: number): Cue {
  return {
    name: "scrubDetent",
    options: { position, gain: detentGain(pointerSpeedPxPerMs) },
    haptic: "detent",
  };
}

export function cueForSheet(opening: boolean): Cue {
  return { name: opening ? "sheetOpen" : "sheetClose", haptic: opening ? "open" : "close" };
}

export function cueForSwitch(turningOn: boolean): Cue {
  return { name: turningOn ? "toggleOn" : "toggleOff", haptic: "select" };
}

/** Releasing the volume slider plays a sample so the level can be judged. */
export function cueForVolumeRelease(): Cue {
  return { name: "toggleOn" };
}

export type GenerateCueKind = "started" | "finished" | "failed";

export function cueForGenerate(kind: GenerateCueKind): Cue {
  switch (kind) {
    case "started":
      return { name: "generateStart", haptic: "start" };
    case "finished":
      // A podcast is ready to play.
      return { name: "generateDone", haptic: "ready" };
    case "failed":
      return { name: "error", haptic: "error" };
  }
}

/**
 * The Sounds switch plays toggleOff just before the engine goes quiet, a last confirmation, and
 * toggleOn when it comes back. The caller applies the preference after this returns for "off" and
 * before it for "on", because the engine reads the preference at play time.
 */
export function playCue(sink: CueSink | null, cue: Cue | null): boolean {
  if (!sink || !cue) return false;
  return sink.play(cue.name, cue.options);
}
