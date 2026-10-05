import { execFile } from "node:child_process";
import { z } from "zod";
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
  remote?: string;
  /** Defaults to the current branch. */
  branch?: string;
  /** Fetch first so the answer reflects the remote now, not at the last fetch. */
  fetch?: boolean;
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
  const remote = options.remote ?? "origin";
  const branch =
    options.branch ?? (await gitOutput(git, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (options.fetch ?? true) await gitOutput(git, ["fetch", "--quiet", remote]);
  const tracking = `refs/remotes/${remote}/${branch}`;
  const known = await git(["rev-parse", "--verify", "--quiet", tracking]);
  if (known.code !== 0) return false;
  const count = await gitOutput(git, ["rev-list", "--count", `HEAD..${tracking}`]);
  return Number.parseInt(count.trim(), 10) > 0;
}

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the GitHub CLI. Injected so tests and callers without `gh` never shell out. */
export type GhRunner = (args: readonly string[]) => Promise<GhResult>;

/** A runner that executes the real `gh` binary in `cwd`. */
export function createGhRunner(cwd: string): GhRunner {
  return (args) =>
    new Promise<GhResult>((resolve, reject) => {
      execFile(
        "gh",
        [...args],
        { cwd, encoding: "utf8", windowsHide: true },
        (error, stdout, stderr) => {
          if (error === null) resolve({ code: 0, stdout, stderr });
          else if (typeof error.code === "number") resolve({ code: error.code, stdout, stderr });
          else reject(error);
        },
      );
    });
}

export interface RunInProgressOptions {
  /** Workflow file of the pipeline run. */
  workflow?: string;
  /** owner/name, when the checkout's remote is not the right repository. */
  repo?: string;
}

const RunList = z.array(z.object({ status: z.string() }));

/**
 * True when a run of the pipeline workflow has not finished (queued, waiting or in progress), so a
 * local writer should stand down. Throws when `gh` fails: "unknown" must not read as "idle".
 */
export async function hasRunInProgress(
  gh: GhRunner,
  options: RunInProgressOptions = {},
): Promise<boolean> {
  const args = [
    "run",
    "list",
    "--workflow",
    options.workflow ?? "run.yml",
    "--limit",
    "20",
    "--json",
    "status",
    ...(options.repo ? ["--repo", options.repo] : []),
  ];
  const result = await gh(args);
  if (result.code !== 0) {
    throw new Error(
      `gh run list failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  const runs = RunList.parse(JSON.parse(result.stdout === "" ? "[]" : result.stdout));
  return runs.some((run) => run.status !== "completed");
}
