import type { PlayerDigestData } from "../../types/contracts";
import type { PlayerErrorKind, PlayerState } from "./playerTypes";
import { briefingLengthLabel } from "./readerMath";

/**
 * What a recording is, and how long, for the line under its title when no story is being read: the
 * bar's caption, and the page's until the first story starts.
 */
export function recordingCaption(digest: PlayerDigestData | undefined): string {
  if (!digest) return "";
  const kind = recordingKind(digest);
  return digest.audio ? `${kind} \u00b7 ${briefingLengthLabel(digest.audio.duration_ms)}` : kind;
}

/**
 * The word the Library puts first on its card for the same recording: Daily or Weekly for a
 * briefing, Discussion for an episode with two voices, Episode otherwise (what is made on request).
 */
function recordingKind(digest: PlayerDigestData): string {
  // An episode carries its script; a briefing does not.
  if (digest.turns)
    return digest.turns.some((turn) => turn.speaker === "b") ? "Discussion" : "Episode";
  if (digest.kind === "weekly") return "Weekly";
  return digest.kind === "on-demand" ? "Episode" : "Daily";
}

/** One short line for the mini player, where the full message would not fit. */
export function errorSummary(kind: PlayerErrorKind): string {
  switch (kind) {
    case "network":
      return "Audio did not load";
    case "decode":
      return "Audio could not play";
    case "unavailable":
      return "Audio is not available";
    case "blocked":
      return "Playback was blocked";
    case "unknown":
      return "Audio could not play";
  }
}

/** The accessible name of the play toggle. Visible text and name always agree. */
export function toggleLabel(state: Pick<PlayerState, "status">): string {
  switch (state.status) {
    case "playing":
    case "loading":
      return "Pause";
    case "ended":
      return "Play again";
    case "error":
      return "Try again";
    case "idle":
    case "paused":
      return "Play";
  }
}

export function isPlayingStatus(status: PlayerState["status"]): boolean {
  return status === "playing" || status === "loading";
}
