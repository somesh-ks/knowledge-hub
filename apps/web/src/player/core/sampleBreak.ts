/**
 * A voice sample heard over a playing podcast (owner, 2026-11-03). The podcast fades out and pauses,
 * the sample plays, and when the sample ends or is stopped the podcast fades back in where it was.
 * Two voices at once would talk over each other, and a hard cut feels like a fault.
 *
 * It resumes only a podcast this break paused: one the listener had already paused is left alone,
 * and one they pause, play again or change during the sample is theirs from then on. The pause is
 * `system`, so it makes no sound, says nothing and leaves no "Paused by another app" notice.
 *
 * This file imports the player only as types: the Settings and Create pages load it with the voice
 * list, and the player's code is not theirs to carry. It reaches the store and the speaker through
 * the tab's slots (tabSlot.ts), which exist only once the player has started.
 */
import type { PlayerState, PlayerStore } from "./playerTypes";
import { peekTabShared } from "./tabSlot";

/**
 * The fade out before the sample, and the fade in after it. Short: a sample is a glance, not a track.
 * The volume follows a square of the time, not a straight line: loudness is heard on a curve, and a
 * straight ramp sounds like it holds and then drops at the end.
 */
export const FADE_OUT_MS = 220;
export const FADE_IN_MS = 450;
const STEP_MS = 16;
/** A resume that has not started playing by now gives the volume back, so a later play is not silent. */
const RESUME_GRACE_MS = 4000;

interface Speaker {
  volume: number;
}

interface BreakDeps {
  store: Pick<PlayerStore, "getState" | "subscribe" | "pause" | "play">;
  speaker: Speaker;
}

export interface Break {
  /**
   * Runs `then` once the podcast is quiet: at once when no fade was needed, otherwise inside the
   * timer that finishes the fade, so a browser that wants a tap behind the sample's play() still
   * sees one close by.
   */
  afterFade(then: () => void): void;
  /** The sample is over: the podcast fades back in, unless the listener has taken it over. */
  end(): void;
  /** True once the break has ended or the listener took the podcast back: a new sample starts a new one. */
  readonly over: boolean;
}

const isPlaying = (state: PlayerState): boolean =>
  state.status === "playing" || state.status === "loading";

/** Only a browser that obeys a volume can fade (iOS ignores it, and there the pause is at once). */
function canFade(speaker: Speaker, target: number): boolean {
  if (target <= 0.02) return false;
  speaker.volume = target / 2;
  const obeyed = Math.abs(speaker.volume - target / 2) < 0.01;
  speaker.volume = target;
  return obeyed;
}

/** Starts a break over the podcast, or returns null when nothing is playing to yield. */
export function beginBreak({ store, speaker }: BreakDeps): Break | null {
  const first = store.getState();
  if (!isPlaying(first)) return null;
  const trackId = first.digestId;
  const target = speaker.volume;
  const fades = canFade(speaker, target);
  // out: fading, paused: ours and quiet, over: the listener took it back or the break ended.
  let phase: "out" | "paused" | "over" = "out";
  let timer: ReturnType<typeof setInterval> | undefined;
  let waiting: (() => void) | null = null;
  let off: () => void = () => undefined;

  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const release = (): void => {
    phase = "over";
    stopTimer();
    off();
    speaker.volume = target;
    const run = waiting;
    waiting = null;
    run?.();
  };
  const pauseNow = (): void => {
    phase = "paused";
    store.pause("system");
    speaker.volume = target;
  };

  // The listener's own move ends the break at once: a pause while the volume falls, or a play or a
  // new item after it.
  off = store.subscribe((state) => {
    if (phase === "out" && !isPlaying(state)) release();
    else if (phase === "paused" && (state.status !== "paused" || state.digestId !== trackId))
      release();
  });

  if (!fades) pauseNow();
  else {
    let step = 0;
    const steps = Math.ceil(FADE_OUT_MS / STEP_MS);
    timer = setInterval(() => {
      step += 1;
      if (phase !== "out") return;
      if (step < steps) {
        speaker.volume = target * (1 - step / steps) ** 2;
        return;
      }
      stopTimer();
      pauseNow();
      const run = waiting;
      waiting = null;
      run?.();
    }, STEP_MS);
  }

  return {
    get over() {
      return phase === "over";
    },
    afterFade(then) {
      if (phase === "out") waiting = then;
      else then();
    },
    end() {
      // The sample stopped before the volume fell: the podcast never went quiet, so it plays on.
      if (phase !== "paused") {
        if (phase === "out") release();
        return;
      }
      phase = "over";
      off();
      // Quiet first, then play, so the first moments are not a jump.
      if (fades) speaker.volume = 0;
      store.play("resume");
      if (!fades) return;
      let ramp: ReturnType<typeof setInterval> | undefined;
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      let offResume: () => void = () => undefined;
      const done = (): void => {
        if (ramp !== undefined) clearInterval(ramp);
        if (giveUp !== undefined) clearTimeout(giveUp);
        offResume();
        speaker.volume = target;
      };
      offResume = store.subscribe((state) => {
        if (state.status === "playing" && ramp === undefined) {
          let step = 0;
          const steps = Math.ceil(FADE_IN_MS / STEP_MS);
          ramp = setInterval(() => {
            step += 1;
            if (step >= steps) done();
            else speaker.volume = target * (step / steps) ** 2;
          }, STEP_MS);
        } else if (state.status === "error" || state.status === "idle") {
          done();
        }
      });
      giveUp = setTimeout(() => {
        if (ramp === undefined) done();
      }, RESUME_GRACE_MS);
    },
  };
}

/** The break over the tab's player, when the player is there and playing. */
export function beginBreakOnTab(): Break | null {
  const store = peekTabShared<PlayerStore>("store");
  const audio = peekTabShared<{ element: unknown }>("audio");
  if (!store || !audio) return null;
  return beginBreak({ store, speaker: audio.element as Speaker });
}
