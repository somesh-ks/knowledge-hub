import type { PlayerError } from "./playerTypes";

/** MediaError codes, as constants because the fake audio in tests has no MediaError class. */
export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export type AudioNoun = "briefing" | "episode";

/**
 * Plain-language messages: what happened, then what to do (config/voice.md). Returns null for an
 * abort, which is what the browser reports when the source changes under it and is not a failure.
 */
export function describeMediaError(
  code: number | undefined,
  isOnline: boolean,
  /** What the recording is called: an episode has a transcript, a briefing its text. */
  noun: AudioNoun = "briefing",
): PlayerError | null {
  if (code === MEDIA_ERR_ABORTED) return null;
  if (!isOnline) {
    return {
      kind: "network",
      // The player tries again by itself when the connection comes back (playerRuntime.ts).
      message: "You are offline. Reconnect to play on.",
    };
  }
  switch (code) {
    case MEDIA_ERR_NETWORK:
      return {
        kind: "network",
        message: "The audio stopped loading. Check your connection, then try again.",
      };
    case MEDIA_ERR_DECODE:
      return {
        kind: "decode",
        message: "This audio could not be played. Try again in a few minutes.",
      };
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      // A missing or expired file and an unsupported format look the same to the element.
      return {
        kind: "unavailable",
        message: `Audio is not available for this ${noun}.`,
      };
    default:
      return {
        kind: "unknown",
        message: "The audio could not be played. Try again in a moment.",
      };
  }
}

/** The error for a rejected `play()` promise. AbortError means a newer load won, so it is not one. */
export function describePlayRejection(
  error: unknown,
  isOnline: boolean,
  noun: AudioNoun = "briefing",
): PlayerError | null {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") return null;
  if (name === "NotAllowedError") {
    return {
      kind: "blocked",
      // "Press" fits a finger and a mouse alike, and is what the bar's own notice says.
      message: "Playback was blocked by the browser. Press play to start.",
    };
  }
  return describeMediaError(
    name === "NotSupportedError" ? MEDIA_ERR_SRC_NOT_SUPPORTED : undefined,
    isOnline,
    noun,
  );
}
