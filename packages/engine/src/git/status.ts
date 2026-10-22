import type { GitRunner } from "./runGit.js";
import { createGitRunner, gitOutput } from "./runGit.js";

/** True when the working tree and index hold no changes, untracked files included. */
export async function isTreeClean(
  root: string,
  git: GitRunner = createGitRunner(root),
): Promise<boolean> {
  return (await gitOutput(git, ["status", "--porcelain", "-uall"])).trim() === "";
}

export interface BehindRemoteOptions {
  git?: GitRunner;
}

/**
 * True when the remote branch has commits the local branch lacks. A branch the remote has never
 * seen is not "behind". A failed fetch throws: a stale answer here could let a writer clobber
 * newer state, so the caller must decide what an unreachable remote means.
 */
export async function isBehindRemote(
  root: string,
  options: BehindRemoteOptions = {},
): Promise<boolean> {
  const git = options.git ?? createGitRunner(root);
  const remote = "origin";
  const branch = (await gitOutput(git, ["symbolic-ref", "--short", "HEAD"])).trim();
  // Fetch first so the answer reflects the remote now, not at the last fetch.
  await gitOutput(git, ["fetch", "--quiet", remote]);
  const tracking = `refs/remotes/${remote}/${branch}`;
  const known = await git(["rev-parse", "--verify", "--quiet", tracking]);
  if (known.code !== 0) return false;
  const count = await gitOutput(git, ["rev-list", "--count", `HEAD..${tracking}`]);
  return Number.parseInt(count.trim(), 10) > 0;
}

/**
 * Whether the branch holds commits its remote does not: a commit made whose push failed. Reads the
 * remote-tracking branch as the last fetch left it (isBehindRemote fetches first).
 */
export async function isAheadOfRemote(
  root: string,
  options: BehindRemoteOptions = {},
): Promise<boolean> {
  const git = options.git ?? createGitRunner(root);
  const branch = (await gitOutput(git, ["symbolic-ref", "--short", "HEAD"])).trim();
  const tracking = `refs/remotes/origin/${branch}`;
  const known = await git(["rev-parse", "--verify", "--quiet", tracking]);
  if (known.code !== 0) return false;
  const count = await gitOutput(git, ["rev-list", "--count", `${tracking}..HEAD`]);
  return Number.parseInt(count.trim(), 10) > 0;
}
