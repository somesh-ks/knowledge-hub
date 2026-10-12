import { FORMAT_LABELS } from "../../lib/formatLabels";
import type { PlayerDigestData } from "../../types/contracts";
import type { PlayerError, PlayerErrorKind, PlayerState } from "./playerTypes";
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
export function errorSummary(error: Pick<PlayerError, "kind" | "summary">): string {
  if (error.summary) return error.summary;
  switch (error.kind) {
    case "network":
      return "Audio did not load";
    case "unavailable":
      return "Audio is not available";
    case "blocked":
      return "Playback was blocked";
    default:
      // Decode and unknown failures; a refusal always carries its reason as its summary.
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

export type TransportGlyph = "play" | "pause" | "refresh" | "replay";

/** The play toggle's name says what its glyph draws, so the two never disagree. */
const GLYPH_NAMES: Record<TransportGlyph, string> = {
  play: "Play",
  pause: "Pause",
  refresh: "Try again",
  replay: "Play again",
};

export function toggleLabel(
  state: Pick<PlayerState, "status"> & { error?: PlayerState["error"] },
): string {
  return GLYPH_NAMES[transportGlyph(state.status, state.error)];
}

/**
 * The glyph the main transport button draws, one rule for the page's disc and the bar so a glyph
 * never disagrees with the button's name (toggleLabel): refresh to try again after a failure (a
 * standing refusal is not mended by trying again, so it keeps play), replay at the end of a
 * recording, pause while playing, play otherwise.
 */
export function transportGlyph(
  status: PlayerState["status"],
  error?: PlayerState["error"],
): TransportGlyph {
  if (status === "error") return keepsPlayFace(error) ? "play" : "refresh";
  if (status === "ended") return "replay";
  return isPlayingStatus(status) ? "pause" : "play";
}

/**
 * A failure no press can mend now: a refusal that stands, or the connection, which plays on by
 * itself when it returns. Its controls keep Play, with the reason as their line, never Try again.
 */
export function keepsPlayFace(error: PlayerState["error"] | undefined): boolean {
  return error?.kind === "refused" || error?.kind === "offline";
}

export function isPlayingStatus(status: PlayerState["status"]): boolean {
  return status === "playing" || status === "loading";
}
