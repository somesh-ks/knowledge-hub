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
}

export function createSwitchableAudio(element: AudioLike): SwitchableAudio {
  let target = element;
  const listeners = new Map<string, Set<() => void>>();
  /** One relay per event type, attached to whichever audio is in use. */
  const relays = new Map<string, () => void>();

  function relayFor(type: string): () => void {
    let relay = relays.get(type);
    if (!relay) {
      relay = () => {
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
