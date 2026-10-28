import type { CommitOutcome } from "../git/commit.js";
import { PodcastError } from "./types.js";

/**
 * A failed run in one plain sentence for the run indicator (failure.json in Blob carries it to the
 * status route). The listener never sees a git word: the log on GitHub has those.
 */
export function commitFailureReason(outcome: CommitOutcome): string | null {
  switch (outcome.status) {
    case "push_failed":
      return outcome.reason === "rebase_conflict" || outcome.reason === "rejected"
        ? "Another run saved at the same moment, so the episode could not be added. Try again."
        : "The episode was made but could not be saved. Try again.";
    case "refused":
      return "The episode was not saved: a safety check refused the change.";
    case "nothing_to_commit":
      return "The episode was made but nothing was saved. Try again.";
    default:
      return null;
  }
}

/** A thrown error as a sentence: a request or story problem says its own words; the rest is generic. */
export function errorFailureReason(error: unknown): string {
  return error instanceof PodcastError
    ? error.message.slice(0, 280)
    : "Something unexpected stopped the run. Its log has the details.";
}
