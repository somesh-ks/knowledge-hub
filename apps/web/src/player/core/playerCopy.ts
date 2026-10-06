import type { PlayerErrorKind, PlayerState } from "./playerTypes";

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
