import { describe, expect, it } from "vitest";
import type { CommitOutcome } from "../src/git/commit.js";
import { commitFailureReason, errorFailureReason } from "../src/podcast/failureReason.js";
import { InvalidRequestError, PodcastError } from "../src/podcast/types.js";

const pushFailed = (
  reason: "rebase_conflict" | "rejected" | "error" | "detached_head",
): CommitOutcome => ({
  status: "push_failed",
  reason,
  sha: "abc1234",
  paths: [],
  retries: 3,
  detail: "hint: git words",
  conflicts: [],
});

// The 2026-10-27 Catch up said only "Stopped while publishing"; the listener never learned why.
describe("a failed run's reason", () => {
  it("says a clash with another run in words, with no git in them", () => {
    for (const reason of ["rebase_conflict", "rejected"] as const) {
      const text = commitFailureReason(pushFailed(reason));
      expect(text).toMatch(/Another run saved at the same moment/);
      expect(text).not.toMatch(/rebase|git|push|conflict/i);
    }
  });

  it("says a save that failed any other way, and a refused one", () => {
    expect(commitFailureReason(pushFailed("error"))).toMatch(/could not be saved/);
    expect(commitFailureReason({ status: "refused", reason: "guard", offending: ["x"] })).toMatch(
      /safety check/,
    );
  });

  it("has no reason for an outcome that was not a failure", () => {
    expect(commitFailureReason({ status: "pushed", sha: "a", paths: [], retries: 0 })).toBeNull();
  });

  it("repeats a request or story problem and hides any other error's words", () => {
    expect(errorFailureReason(new PodcastError("No stories in Design in the last 7 days."))).toBe(
      "No stories in Design in the last 7 days.",
    );
    expect(errorFailureReason(new InvalidRequestError("bad request"))).toBe("bad request");
    expect(errorFailureReason(new Error("ECONNRESET at 10.0.0.1 token=abc"))).not.toMatch(
      /ECONNRESET|token/,
    );
  });
});
