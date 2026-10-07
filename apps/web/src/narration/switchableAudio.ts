/**
 * The audio the player store is given: the real element behind a seam.
 *
 * Narration on Play needs trackAudio.ts between the store and the element, but that adapter is only
 * wanted once a listener plays a briefing that has no finished file, which most visits never do.
 * So the page ships this thin stand-in, and the narration code, loaded on demand, slots the adapter
 * in later with `use`. The store keeps the one object it was given and never knows.
 */
import type { AudioLike } from "../player/core/playerTypes";

export interface SwitchableAudio extends AudioLike {
  /** The element underneath, for an adapter to wrap. */
  readonly element: AudioLike;
  /** Routes every read, write and event through `next` from now on. */
  use(next: AudioLike): void;
  /**
   * Starts and stops the element inside a tap, so a phone lets it be started later without one.
   * iOS only plays audio that a tap started, and narration starts seconds after the tap, once the
   * first file exists. An element that a tap has started once may be started again by script.
   * Nothing is heard, and listeners hear nothing of it either. `silence` is a short silent file,
   * used when the element holds no source.
   */
  prime(silence: string): void;
}

/** Priming gives up waiting for the element to settle after this long. */
const PRIME_TIMEOUT_MS = 1_000;

export function createSwitchableAudio(element: AudioLike): SwitchableAudio {
  let target = element;
  const listeners = new Map<string, Set<() => void>>();
  /** One relay per event type, attached to whichever audio is in use. */
  const relays = new Map<string, () => void>();

  /** True while the element is being primed: its events are not the track's. */
  let priming = false;

  function relayFor(type: string): () => void {
    let relay = relays.get(type);
    if (!relay) {
      relay = () => {
        if (priming) return;
        for (const listener of [...(listeners.get(type) ?? [])]) listener();
      };
      relays.set(type, relay);
    }
    return relay;
  }

  return {
    element,
    use(next) {
      if (next === target) return;
      for (const [type, relay] of relays) {
        target.removeEventListener(type, relay);
        next.addEventListener(type, relay);
      }
      target = next;
    },
    prime(silence) {
      // Only the bare element is primed, and only while it is idle: a playing one is already started.
      if (priming || target !== element || !element.paused) return;
      priming = true;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        element.removeEventListener("emptied", finish);
        priming = false;
      };
      if (element.src !== "") {
        // A source is loaded but was never started. Start and stop in the same breath: nothing is
        // decoded, and the promise settles after the element's own pause event has gone by.
        Promise.resolve(element.play()).then(finish, finish);
        element.pause();
      } else {
        const release = (): void => {
          element.pause();
          element.removeAttribute("src");
          element.load();
        };
        // The element says "emptied" last, after its pause: from then on its events count again.
        element.addEventListener("emptied", finish);
        element.src = silence;
        Promise.resolve(element.play()).then(release, release);
      }
      setTimeout(finish, PRIME_TIMEOUT_MS);
    },
    get src() {
      return target.src;
    },
    set src(value: string) {
      target.src = value;
    },
    get currentTime() {
      return target.currentTime;
    },
    set currentTime(value: number) {
      target.currentTime = value;
    },
    get duration() {
      return target.duration;
    },
    get paused() {
      return target.paused;
    },
    get ended() {
      return target.ended;
    },
    get readyState() {
      return target.readyState;
    },
    get error() {
      return target.error;
    },
    get playbackRate() {
      return target.playbackRate;
    },
    set playbackRate(value: number) {
      target.playbackRate = value;
    },
    get defaultPlaybackRate() {
      return target.defaultPlaybackRate;
    },
    set defaultPlaybackRate(value: number) {
      target.defaultPlaybackRate = value;
    },
    get preservesPitch() {
      return target.preservesPitch;
    },
    set preservesPitch(value: boolean) {
      target.preservesPitch = value;
    },
    get webkitPreservesPitch() {
      return target.webkitPreservesPitch;
    },
    set webkitPreservesPitch(value: boolean | undefined) {
      if ("webkitPreservesPitch" in element) target.webkitPreservesPitch = value;
    },
    get preload() {
      return target.preload;
    },
    set preload(value: string) {
      target.preload = value;
    },
    play() {
      return target.play();
    },
    pause() {
      target.pause();
    },
    load() {
      target.load();
    },
    removeAttribute(name: string) {
      target.removeAttribute(name);
    },
    addEventListener(type: string, listener: () => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
        target.addEventListener(type, relayFor(type));
      }
      set.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
}
