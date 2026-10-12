import { FORMAT_LABELS } from "../../lib/formatLabels";
import type { PlayerDigestData } from "../../types/contracts";
import type { PlayerErrorKind, PlayerState } from "./playerTypes";
import { briefingLengthLabel } from "./readerMath";

/**
 * What a recording is, and how long, for the line under its title when no story is being read: the
 * bar's caption, and the page's until the first story starts.
 */
export function recordingCaption(
  digest: PlayerDigestData | undefined,
  /** The loaded audio's real length in seconds, once known: it wins over the estimate. */
  durationSec = 0,
): string {
  if (!digest) return "";
  const kind = recordingKind(digest);
  const ms = durationSec > 0 ? durationSec * 1000 : (digest.audio?.duration_ms ?? 0);
  return ms > 0 ? `${kind} \u00b7 ${briefingLengthLabel(ms)}` : kind;
}

/**
 * The word the Library puts first on its card for the same recording: Daily or Weekly for a
 * briefing, the episode's format (Readout, Discussion) for an episode, Episode for one that does
 * not say.
 */
export function recordingKind(digest: PlayerDigestData): string {
  const format = digest.format;
  if (format && Object.hasOwn(FORMAT_LABELS, format)) return FORMAT_LABELS[format];
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
/** The one line for a pause another app caused, on the bar and in the open player's notice. */
export const INTERRUPTED_LINE = "Paused by another app";

/**
 * The open player's notice offers an action only where pressing it can help: trying again after a
 * network, decoding or unknown failure, and Play where the browser blocked autoplay. A missing file
 * gets no button of its own (the Play disc, named Try again, is still there).
 */
export function noticeAction(kind: PlayerErrorKind): string | null {
  switch (kind) {
    case "blocked":
      return "Play";
    case "network":
    case "decode":
    case "unknown":
      return "Try again";
    default:
      return null;
  }
}

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
