/**
 * A fake narration player with the same surface the real store will have: one external store the
 * UI reads, a timer-driven playhead instead of an <audio> element, and no network.
 *
 * Two subscription channels, because they change at different rates and cost different amounts:
 * - subscribe: coarse state (status, item, rate). Changes a few times a minute.
 * - onFrame: the playhead. Fires every animation frame while playing. Subscribers must write to
 *   leaf elements only and avoid allocation.
 */
import { type SampleItem, SECTION_TITLES, spokenText, type Timeline } from "./sampleContent.js";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface PlayerState {
  status: PlayerStatus;
  /** Seconds from the start of the digest. */
  time: number;
  duration: number;
  rate: number;
  itemIndex: number;
  /** Index into timeline.sections. */
  sectionIndex: number;
  /** True while the user is dragging the scrubber. The playhead is held. */
  scrubbing: boolean;
  /** True once playback has started at least once, so the mini player may appear. */
  hasStarted: boolean;
}

export interface Player {
  getState: () => PlayerState;
  subscribe: (listener: (state: PlayerState, previous: PlayerState) => void) => () => void;
  onFrame: (listener: (time: number, duration: number) => void) => () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Moves the playhead. Does not change play state. */
  seek: (time: number) => void;
  /** Starts the item and plays. */
  playItem: (index: number) => void;
  next: () => boolean;
  previous: () => boolean;
  skip: (deltaSeconds: number) => void;
  setRate: (rate: number) => void;
  beginScrub: () => void;
  scrubTo: (time: number) => void;
  endScrub: (time: number) => void;
  /** Simulated slow network: the first play buffers for this many ms. */
  setBufferDelay: (ms: number) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  isNarrating: () => boolean;
  itemAt: (time: number) => number;
}

export function createPlayer(timeline: Timeline, items: readonly SampleItem[]): Player {
  let state: PlayerState = {
    status: "idle",
    time: 0,
    duration: timeline.durationSec,
    rate: 1,
    itemIndex: 0,
    sectionIndex: 0,
    scrubbing: false,
    hasStarted: false,
  };
  const listeners = new Set<(state: PlayerState, previous: PlayerState) => void>();
  const frameListeners = new Set<(time: number, duration: number) => void>();
  let raf = 0;
  let lastFrame = 0;
  let bufferDelay = 0;
  let bufferTimer = 0;
  let wasPlayingBeforeScrub = false;
  let voiceEnabled = false;
  let spokenItem = -1;

  const itemAt = (time: number): number => {
    let found = 0;
    for (const entry of timeline.items) {
      if (time >= entry.startSec) found = entry.index;
      else break;
    }
    return found;
  };

  const sectionOf = (itemIndex: number): number => {
    const slug = timeline.items[itemIndex]?.section;
    return Math.max(
      0,
      timeline.sections.findIndex((section) => section.slug === slug),
    );
  };

  function commit(patch: Partial<PlayerState>): void {
    const previous = state;
    const next = { ...state, ...patch };
    next.itemIndex = itemAt(next.time);
    next.sectionIndex = sectionOf(next.itemIndex);
    state = next;
    const changed =
      previous.status !== next.status ||
      previous.itemIndex !== next.itemIndex ||
      previous.rate !== next.rate ||
      previous.scrubbing !== next.scrubbing ||
      previous.hasStarted !== next.hasStarted;
    if (changed) for (const listener of listeners) listener(state, previous);
    for (const listener of frameListeners) listener(state.time, state.duration);
    syncVoice();
  }

  function syncVoice(): void {
    if (typeof speechSynthesis === "undefined") return;
    if (!voiceEnabled || state.status !== "playing") {
      if (spokenItem !== -1) {
        speechSynthesis.cancel();
        spokenItem = -1;
      }
      return;
    }
    if (spokenItem === state.itemIndex) return;
    spokenItem = state.itemIndex;
    const item = items[state.itemIndex];
    const entry = timeline.items[state.itemIndex];
    if (!item || !entry) return;
    const previous = items[state.itemIndex - 1];
    const text = spokenText(item, !previous || previous.section !== item.section);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = state.rate;
    utterance.lang = "en";
    speechSynthesis.speak(utterance);
  }

  function frame(now: number): void {
    if (state.status !== "playing") return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const time = state.time + dt * state.rate;
    if (time >= state.duration) {
      commit({ time: state.duration, status: "ended" });
      return;
    }
    commit({ time });
    raf = requestAnimationFrame(frame);
  }

  function startLoop(): void {
    cancelAnimationFrame(raf);
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function beginPlayback(): void {
    const from = state.status === "ended" ? 0 : state.time;
    commit({ status: "playing", time: from, hasStarted: true });
    startLoop();
  }

  function play(): void {
    if (state.status === "playing" || state.status === "loading") return;
    if (bufferDelay > 0 && !state.hasStarted) {
      commit({ status: "loading", hasStarted: true });
      window.clearTimeout(bufferTimer);
      bufferTimer = window.setTimeout(beginPlayback, bufferDelay);
      return;
    }
    beginPlayback();
  }

  function pause(): void {
    window.clearTimeout(bufferTimer);
    cancelAnimationFrame(raf);
    if (state.status === "playing" || state.status === "loading") commit({ status: "paused" });
  }

  function seek(time: number): void {
    const clamped = Math.min(state.duration, Math.max(0, time));
    spokenItem = -1;
    commit({ time: clamped });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    play,
    pause,
    toggle() {
      if (state.status === "playing" || state.status === "loading") pause();
      else play();
    },
    seek,
    playItem(index) {
      const entry = timeline.items[Math.min(timeline.items.length - 1, Math.max(0, index))];
      if (!entry) return;
      spokenItem = -1;
      commit({ time: entry.startSec });
      play();
    },
    next() {
      const target = state.itemIndex + 1;
      const entry = timeline.items[target];
      if (!entry) return false;
      spokenItem = -1;
      commit({ time: entry.startSec });
      return true;
    },
    previous() {
      // Past the first three seconds, "previous" restarts the item, like every audio player.
      const current = timeline.items[state.itemIndex];
      if (!current) return false;
      const restart = state.time - current.startSec > 3 || state.itemIndex === 0;
      const target = restart ? state.itemIndex : state.itemIndex - 1;
      const entry = timeline.items[target];
      if (!entry) return false;
      spokenItem = -1;
      commit({ time: entry.startSec });
      return true;
    },
    skip(delta) {
      seek(state.time + delta);
    },
    setRate(rate) {
      spokenItem = -1;
      commit({ rate });
    },
    beginScrub() {
      wasPlayingBeforeScrub = state.status === "playing";
      if (wasPlayingBeforeScrub) pause();
      commit({ scrubbing: true });
    },
    scrubTo(time) {
      commit({ time: Math.min(state.duration, Math.max(0, time)) });
    },
    endScrub(time) {
      spokenItem = -1;
      commit({ scrubbing: false, time: Math.min(state.duration, Math.max(0, time)) });
      if (wasPlayingBeforeScrub) play();
      wasPlayingBeforeScrub = false;
    },
    setBufferDelay(ms) {
      bufferDelay = ms;
    },
    setVoiceEnabled(enabled) {
      voiceEnabled = enabled;
      if (!enabled && typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      spokenItem = -1;
      syncVoice();
    },
    isNarrating: () => state.status === "playing",
    itemAt,
  };
}

export function sectionTitleFor(timeline: Timeline, itemIndex: number): string {
  const slug = timeline.items[itemIndex]?.section;
  return slug ? SECTION_TITLES[slug] : "";
}
