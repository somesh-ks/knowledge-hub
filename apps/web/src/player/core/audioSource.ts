/**
 * Which file of a briefing's narration this browser plays (plan 19.1). The engine publishes the MP3
 * and the same speech as Opus in MP4 (`.m4a`). The m4a is first when the browser does not rule it
 * out, then the MP3, which every browser plays. WebM is not published: WebKit answers "probably" for
 * it and then never plays it, so a canPlayType answer alone is not trusted either; the store walks
 * on to the next source when the chosen one errors or stalls (shouldFallBack).
 */
export interface AudioSources {
  url: string;
  m4a_url?: string | undefined;
}

export type CanPlayType = (type: string) => string;

export const M4A_OPUS = "audio/mp4; codecs=opus";

/** The files to try, in order. "probably" and "maybe" both say the browser can try; "" says it cannot. */
export function audioCandidates(audio: AudioSources, canPlayType: CanPlayType): string[] {
  return audio.m4a_url && canPlayType(M4A_OPUS) !== "" ? [audio.m4a_url, audio.url] : [audio.url];
}

/** The page's own answer, asked of an element that is never attached or loaded. */
export function browserCanPlayType(): CanPlayType {
  if (typeof document === "undefined") return () => "";
  const probe = document.createElement("audio");
  return (type) => probe.canPlayType(type);
}

export const PLAY_RESOLVE_LIMIT_MS = 4000;
export const ADVANCE_CHECK_MS = 2000;
const MIN_ADVANCE_SEC = 0.5;

export interface PlaybackProbe {
  /** The element fired `error`. */
  errored: boolean;
  /** play() has resolved. */
  playResolved: boolean;
  /** Since play() was called. */
  sincePlayMs: number;
  /** Since play() resolved, or null while it has not. */
  sinceResolveMs: number | null;
  /** How far currentTime has moved since play() was called, in seconds. */
  advancedSec: number;
}

/** Whether the chosen source should be given up for the next: it failed, never started, or never moved. */
export function shouldFallBack(probe: PlaybackProbe): boolean {
  if (probe.errored) return true;
  if (!probe.playResolved) return probe.sincePlayMs >= PLAY_RESOLVE_LIMIT_MS;
  return (
    probe.sinceResolveMs !== null &&
    probe.sinceResolveMs >= ADVANCE_CHECK_MS &&
    probe.advancedSec < MIN_ADVANCE_SEC
  );
}
