import type { Logger } from "../context.js";
import type { GitRunner } from "./runGit.js";

/**
 * What a fast-forward did: whether the checkout moved, and the paths the incoming commits changed.
 * `changed` is null when the checkout moved but the paths could not be listed: that must never read
 * as "nothing changed".
 */
export interface FastForward {
  moved: boolean;
  changed: string[] | null;
}

const NOT_MOVED: FastForward = { moved: false, changed: [] };

/**
 * Brings the checkout up to the remote branch it is on, by fast-forward only. A run that waited
 * for its publish time reads state/ and Digests/ from the checkout it made at job start, so
 * whatever was pushed meanwhile (an on-demand run, a config commit) would make its own push a
 * rebase conflict (D209). Best effort: a checkout that cannot fast-forward (a tracked file the
 * incoming commits also change, a lost network) keeps what it has, which is what a run did before.
 */
export async function fastForwardToRemote(
  run: GitRunner,
  log: Logger,
  remote = "origin",
): Promise<FastForward> {
  const head = await run(["symbolic-ref", "--short", "HEAD"]);
  const branch = head.stdout.trim();
  if (head.code !== 0 || branch === "") {
    log.warn("The checkout is not on a branch, so it was not brought up to date after the wait");
    return NOT_MOVED;
  }
  const before = (await run(["rev-parse", "HEAD"])).stdout.trim();
  const fetched = await run(["fetch", remote, branch]);
  if (fetched.code !== 0) {
    log.warn("Could not fetch before committing; the checkout from job start stands", {
      detail: lastLine(fetched.stderr),
    });
    return NOT_MOVED;
  }
  const merged = await run(["merge", "--ff-only", "FETCH_HEAD"]);
  if (merged.code !== 0) {
    log.warn("Could not fast-forward before committing; the checkout from job start stands", {
      detail: lastLine(merged.stderr || merged.stdout),
    });
    return NOT_MOVED;
  }
  const diff = await run(["diff", "--name-only", before, "HEAD"]);
  const changed = diff.code === 0 ? diff.stdout.split("\n").filter(Boolean) : null;
  return { moved: true, changed };
}

function lastLine(text: string): string {
  return text.trim().split("\n").slice(-1).join(" ");
}
