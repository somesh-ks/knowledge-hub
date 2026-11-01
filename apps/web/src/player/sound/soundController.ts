/**
 * The sound engine, loaded lazily. `@singularity/sound` stays out of the first-load bundle: it is
 * fetched when the browser is idle or at the first gesture, whichever comes first. Until then every
 * cue is a quiet no-op, which is the right behavior: no sound is ever required.
 */
import type { SoundEngine } from "@singularity/sound";
import {
  createHaptics,
  detectHapticSupport,
  type Haptics,
  iosTick,
} from "../../design-system/haptics";
import type { PlayerStore } from "../core/playerTypes";
import type { PreferencesStore } from "../core/preferences";
import { type Cue, cueForPlayerEvent, playCue } from "./soundMap";

let engine: SoundEngine | null = null;
let loading: Promise<void> | null = null;
/** When a cue was last chosen by any path, so the delegated click cue never doubles one. */
let lastCueAt = Number.NEGATIVE_INFINITY;
/** The name of the cue at `lastCueAt`, so a close that follows an open is told from its echo. */
let lastCueName = "";
let removeUnlock: (() => void) | null = null;
/** Bumped by every teardown, so a load that was still in flight can tell it is no longer wanted. */
let generation = 0;
/** The wiring of the running sound, so a cue asked for before the engine exists can start the load. */
let wired: SoundWiring | null = null;
/** The latest interface cue asked for while the engine was still loading, played once it is ready. */
let pending: { cue: Cue; at: number } | null = null;
/** A cue that waited longer than this for the engine is stale: it would sound unrelated to its tap. */
const PENDING_CUE_MS = 1_500;

let haptics: Haptics | null = null;

/** The device's touch feedback, made on first use. The Haptics choice is read at every fire. */
export function getHaptics(): Haptics {
  haptics ??= createHaptics({
    support: detectHapticSupport(),
    isEnabled: () => wired?.preferences.get().haptics ?? false,
    vibrate: (pattern) => navigator.vibrate(pattern),
    tick: iosTick(),
    isVisible: () => document.visibilityState === "visible",
    // What a test, and anything else that cares, sees: the intent, never a pattern.
    onFire: (intent) =>
      document.dispatchEvent(new CustomEvent("singularity:haptic", { detail: intent })),
  });
  return haptics;
}

export interface SoundWiring {
  store: PlayerStore;
  preferences: PreferencesStore;
}

function loadEngine({ store, preferences }: SoundWiring): Promise<void> {
  const wanted = generation;
  loading ??= import("@singularity/sound")
    .then(({ createSoundEngine, installGestureUnlock }) => {
      if (wanted !== generation) return;
      engine = createSoundEngine({
        isEnabled: () => preferences.getSoundsEnabled(),
        getVolume: () => preferences.get().volume,
        // Read at play time, so ducking follows the narration the instant it starts or stops.
        isNarrationPlaying: () => store.isNarrating(),
      });
      removeUnlock = installGestureUnlock(engine);
      // The tap that started this load came before the listeners above existed: unlock for it now
      // (its gesture is still fresh) and play the cue it asked for, instead of dropping the first tap.
      const waiting = pending;
      pending = null;
      if (waiting && performance.now() - waiting.at < PENDING_CUE_MS) {
        engine.unlock();
        playCue(engine, waiting.cue);
      }
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** Starts the lazy load and routes player events to sounds. Returns a teardown. */
export function startSound(wiring: SoundWiring): () => void {
  const offEvent = wiring.store.onEvent((event) => {
    // Marked only when it sounded: a cue the engine refused (narration, Sounds off) must not
    // hold back the delegated tick of the same press.
    const cue = cueForPlayerEvent(event);
    // Touch first and whether or not Sounds is on, as playUiCue does (D273, D289): play, pause,
    // next, previous and speed are the most-pressed controls and must be felt with the sound off.
    if (cue?.haptic && getHaptics().fire(cue.haptic)) {
      lastCueAt = performance.now();
      lastCueName = cue.name;
    }
    if (playCue(engine, cue)) {
      lastCueAt = performance.now();
      lastCueName = cue?.name ?? "";
    }
  });
  wired = wiring;

  let idleHandle: number | null = null;
  const onFirstGesture = (): void => {
    void loadEngine(wiring);
    removeGestureListeners();
  };
  const removeGestureListeners = (): void => {
    document.removeEventListener("pointerdown", onFirstGesture, { capture: true });
    document.removeEventListener("keydown", onFirstGesture, { capture: true });
  };
  document.addEventListener("pointerdown", onFirstGesture, { capture: true, passive: true });
  document.addEventListener("keydown", onFirstGesture, { capture: true, passive: true });

  const startIdle = (): void => {
    idleHandle = null;
    void loadEngine(wiring);
  };
  if (typeof requestIdleCallback === "function") {
    idleHandle = requestIdleCallback(startIdle, { timeout: 3_000 });
  } else {
    idleHandle = window.setTimeout(startIdle, 1_500);
  }

  return () => {
    offEvent();
    removeGestureListeners();
    if (idleHandle !== null) {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle);
      else clearTimeout(idleHandle);
    }
    generation += 1;
    wired = null;
    haptics?.cancel();
    pending = null;
    removeUnlock?.();
    removeUnlock = null;
    engine?.dispose();
    engine = null;
    loading = null;
  };
}

/** For the interface: sheets, switches, Generate, scrub detents. Silent until the engine is ready. */
export function playUiCue(cue: Cue | null): boolean {
  if (!cue) return false;
  // Touch first, and whether or not Sounds is on or the engine has loaded: a phone on silent still
  // wants it. A haptic that went out counts as the cue's own for the echo guard (cuePlayedSince),
  // so a sheet's open and the toggle that follows it are not felt twice with Sounds off.
  if (cue.haptic && getHaptics().fire(cue.haptic)) {
    lastCueAt = performance.now();
    lastCueName = cue.name;
  }
  if (!engine && wired) {
    // Not loaded yet (the first tap of a page): kept, and the load started if it has not been.
    pending = { cue, at: performance.now() };
    lastCueAt = pending.at;
    lastCueName = cue.name;
    void loadEngine(wired);
    return false;
  }
  const played = playCue(engine, cue);
  if (played) {
    lastCueAt = performance.now();
    lastCueName = cue.name;
  }
  return played;
}

/**
 * True when some other path chose a cue at or after `since` (a `performance.now()` stamp). A cue
 * named `except` does not count: a menu that closes right after it opened is a new cue, not an echo.
 */
export function cuePlayedSince(since: number, except?: string): boolean {
  return lastCueAt >= since && lastCueName !== except;
}
