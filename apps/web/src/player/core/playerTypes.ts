import type { PlayerDigestData } from "../../types/contracts";
import type { Timeline } from "./timeline";

/** The common speeds, offered as presets. The slider in the player reaches any step between. */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
/** The speed slider's range and step: half speed to double, in twentieths. */
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 2;
export const PLAYBACK_RATE_STEP = 0.05;
export type PlaybackRate = number;

/** A speed the player accepts: inside the range and on a step, so a stored value stays tidy. */
export function isPlaybackRate(value: unknown): value is PlaybackRate {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value < MIN_PLAYBACK_RATE || value > MAX_PLAYBACK_RATE) return false;
  const steps = value / PLAYBACK_RATE_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** The nearest speed on a step, inside the range. A slider's value arrives with float noise. */
export function toPlaybackRate(value: number): PlaybackRate {
  const clamped = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, value));
  return Math.round(Math.round(clamped / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP * 100) / 100;
}

/**
 * How far the skip controls move: ten seconds either way, to hear something again or to move on a
 * little. The transport, the lock screen and headset buttons all read these.
 */
export const SKIP_BACK_SECONDS = 10;
export const SKIP_FORWARD_SECONDS = 10;

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

/** `refused` is a narration refusal that a retry cannot change (a daily cap, a monthly budget). */
export type PlayerErrorKind =
  | "network"
  | "decode"
  | "unavailable"
  | "blocked"
  | "refused"
  | "unknown";

export interface PlayerError {
  kind: PlayerErrorKind;
  /** Plain language: what happened and what to do. */
  message: string;
  /** The mini player's line where the kind's own would be too general; the narration's reason. */
  summary?: string;
}

/** A digest that is loaded into the audio element, with its derived timeline. */
export interface Track {
  digest: PlayerDigestData;
  timeline: Timeline | null;
}

export interface PlayerState {
  /** Id of the loaded digest, or null before the first load. */
  digestId: string | null;
  track: Track | null;
  status: PlayerStatus;
  /** "preparing" when the digest has no audio yet: the controls show the designed waiting state. */
  availability: "ready" | "preparing";
  /**
   * Playhead in seconds at the last coarse change. The live value changes every frame and lives in
   * `getTime()` and `onFrame`, so React never re-renders at frame rate.
   */
  time: number;
  duration: number;
  rate: number;
  itemIndex: number;
  sectionIndex: number;
  scrubbing: boolean;
  /** True once playback has started this session, so the mini player may appear and stay. */
  hasStarted: boolean;
  /** True after 300 ms of waiting for data, so a fast load never flashes a spinner. */
  buffering: boolean;
  /** The system paused playback (a call, an alarm). Resume is offered, never taken. */
  interrupted: boolean;
  error: PlayerError | null;
  /** The previous digest, offered after the last item. Never autoplayed. */
  upNextId: string | null;
}

export type PlayReason = "user" | "resume" | "item" | "scrub";
export type PauseReason = "user" | "system" | "scrub" | "load";
export type ItemChangeCause =
  | "skip-next"
  | "skip-previous"
  | "select"
  | "keyboard"
  | "auto"
  | "seek"
  | "scrub"
  | "load";

/**
 * Semantic moments the sound and announcement layers react to. They are emitted at the instant
 * they should be heard: `willPlay` before the audio element starts and `didPause` after it has
 * paused, so the UI cues land in silence (sound-design.md, Narration and ducking).
 */
export type PlayerEvent =
  | { type: "willPlay"; reason: PlayReason }
  | { type: "didPause"; reason: PauseReason }
  | { type: "itemChanged"; index: number; cause: ItemChangeCause }
  | { type: "rateChanged"; rate: number }
  | { type: "ended" }
  | { type: "interrupted" }
  | { type: "loaded"; digestId: string }
  | { type: "error"; error: PlayerError };

/** The slice of HTMLAudioElement the store uses, so tests can inject a fake. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly readyState: number;
  /** `message` is the reason a playlist gave for a file it could not make, in the listener's words. */
  readonly error: {
    code: number;
    /** The browser's own debug text on a real failure: never shown. */
    message?: string;
    /** Words the narration adapter made for a failure it caused. */
    narrated?: { message: string; summary?: string; standing?: boolean };
  } | null;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  /** Safari before 17 only knows the prefixed name. */
  webkitPreservesPitch?: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type FrameListener = (timeSeconds: number, durationSeconds: number) => void;
export type StateListener = (state: PlayerState, previous: PlayerState) => void;
export type EventListener = (event: PlayerEvent) => void;

export interface PlayerStore {
  getState(): PlayerState;
  /** Coarse changes: status, item, rate, scrubbing. A few times a minute. */
  subscribe(listener: StateListener): () => void;
  /** The playhead, every animation frame while playing. Write to leaf elements only. */
  onFrame(listener: FrameListener): () => void;
  /** Whole-second ticks and every seek, for labels and ARIA values that update once a second. */
  onSecond(listener: () => void): () => void;
  /** Semantic events for sounds and announcements. */
  onEvent(listener: EventListener): () => void;
  getTime(): number;
  isNarrating(): boolean;
  getPageDigest(): PlayerDigestData | null;
  /** Reads the page's digest. Attaches its audio when nothing has started yet. */
  setPageDigest(digest: PlayerDigestData | null): void;
  load(digest: PlayerDigestData): void;
  play(reason?: PlayReason): void;
  pause(reason?: PauseReason): void;
  toggle(): void;
  /** Milliseconds from the start of the digest. Does not change play state. */
  seekTo(ms: number): void;
  playItem(id: string): void;
  playItemAt(index: number): void;
  next(source?: "ui" | "keyboard"): boolean;
  previous(source?: "ui" | "keyboard"): boolean;
  skip(deltaSeconds: number): void;
  setRate(rate: number): void;
  beginScrub(): void;
  /** Seconds. Moves the playhead without touching the audio element. */
  scrubTo(seconds: number): void;
  /** Seconds. Seeks the audio and resumes if it was playing when the scrub began. */
  endScrub(seconds: number): void;
  itemAt(seconds: number): number;
  retry(): void;
  /**
   * Plays the page's digest as soon as its data arrives. "Up next" navigates to the previous
   * digest's page and the new page's data triggers the play, on the same audio element, which
   * browsers already trust to play without a fresh gesture.
   */
  playWhenPageLoads(digestId: string): void;
  /** Pauses, removes every listener the store added and releases the audio element. For tests and hot reload. */
  dispose(): void;
}
