/**
 * The sound engine, loaded lazily. `@dispatch/sound` stays out of the first-load bundle: it is
 * fetched when the browser is idle or at the first gesture, whichever comes first. Until then every
 * cue is a quiet no-op, which is the right behavior: no sound is ever required.
 */
import type { SoundEngine } from "@dispatch/sound";
import type { PlayerStore } from "../core/playerTypes";
import type { PreferencesStore } from "../core/preferences";
import { type Cue, cueForPlayerEvent, playCue } from "./soundMap";

let engine: SoundEngine | null = null;
let loading: Promise<void> | null = null;
/** When a cue was last chosen by any path, so the delegated click cue never doubles one. */
let lastCueAt = Number.NEGATIVE_INFINITY;
let removeUnlock: (() => void) | null = null;
/** Bumped by every teardown, so a load that was still in flight can tell it is no longer wanted. */
let generation = 0;

export interface SoundWiring {
  store: PlayerStore;
  preferences: PreferencesStore;
}

function loadEngine({ store, preferences }: SoundWiring): Promise<void> {
  const wanted = generation;
  loading ??= import("@dispatch/sound")
    .then(({ createSoundEngine, installGestureUnlock }) => {
      if (wanted !== generation) return;
      engine = createSoundEngine({
        isEnabled: () => preferences.getSoundsEnabled(),
        getVolume: () => preferences.get().volume,
        // Read at play time, so ducking follows the narration the instant it starts or stops.
        isNarrationPlaying: () => store.isNarrating(),
      });
      removeUnlock = installGestureUnlock(engine);
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/** Starts the lazy load and routes player events to sounds. Returns a teardown. */
export function startSound(wiring: SoundWiring): () => void {
  const offEvent = wiring.store.onEvent((event) => {
    const cue = cueForPlayerEvent(event);
    if (cue) lastCueAt = performance.now();
    playCue(engine, cue);
  });

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
    removeUnlock?.();
    removeUnlock = null;
    engine?.dispose();
    engine = null;
    loading = null;
  };
}

/** For the interface: sheets, switches, Generate, scrub detents. Silent until the engine is ready. */
export function playUiCue(cue: Cue | null): boolean {
  if (cue) lastCueAt = performance.now();
  return playCue(engine, cue);
}

/** True when some other path chose a cue at or after `since` (a `performance.now()` stamp). */
export function cuePlayedSince(since: number): boolean {
  return lastCueAt >= since;
}
