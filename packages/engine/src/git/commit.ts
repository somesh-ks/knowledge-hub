import { copiedFromStore } from "../store/configDocs.js";
import { CONFIG_DOCUMENT_PATHS } from "../store/configPaths.js";
import type { ChangedPath, GitCommand } from "./guard.js";
import {
  ALLOWLISTS,
  findDigestContentViolations,
  findViolations,
  readChangedPaths,
} from "./guard.js";
import type { GitRunner } from "./runGit.js";
import { createGitRunner, gitOutput } from "./runGit.js";

export interface BotIdentity {
  name: string;
  email: string;
}

export const DEFAULT_BOT: BotIdentity = {
  name: "singularity-bot",
  email: "singularity-bot@users.noreply.github.com",
};

/**
 * The identity unattended commits use. Vercel Hobby only deploys commits authored by the team
 * owner, so the workflows set SINGULARITY_GIT_NAME and SINGULARITY_GIT_EMAIL to the owner's GitHub
 * identity. Both must be set; otherwise the bot identity applies.
 */
export function identityFromEnv(
  env: Record<string, string | undefined> = process.env,
): BotIdentity | undefined {
  const name = (env.SINGULARITY_GIT_NAME ?? env.DISPATCH_GIT_NAME)?.trim();
  const email = (env.SINGULARITY_GIT_EMAIL ?? env.DISPATCH_GIT_EMAIL)?.trim();
  return name && email ? { name, email } : undefined;
}

/** Retries after the first push, each preceded by `git pull --rebase`. */
export const DEFAULT_PUSH_RETRIES = 3;

const CONVENTIONAL =
  /^(?:feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([a-z0-9._/-]+\))?!?: \S/;

/**
 * Push output that means "someone else pushed first", the only case a rebase can fix. Two pushes in
 * the same instant make GitHub refuse the loser with a ref-lock race ("[remote rejected] ... cannot
 * lock ref" or "incorrect old value"), which a rebase fixes too (2026-10-21, an episode delete).
 */
const NON_FAST_FORWARD =
  /non-fast-forward|fetch first|Updates were rejected|\[rejected\]|cannot lock ref|incorrect old value provided/i;

export interface CommitAndPushInput {
  root: string;
  /** Conventional Commit message, for example "chore(audio): add narration for 2026-10-07". */
  message: string;
  /** Selects the write allowlist. */
  command: GitCommand;
  push: boolean;
  identity?: BotIdentity;
  /** Injected for tests; defaults to real git in `root`. */
  git?: GitRunner;
}

export type PushFailureReason = "rebase_conflict" | "rejected" | "error" | "detached_head";

export type CommitOutcome =
  | { status: "nothing_to_commit" }
  | { status: "refused"; reason: "guard" | "message"; offending: string[] }
  | { status: "committed"; sha: string; paths: string[] }
  | { status: "pushed"; sha: string; paths: string[]; retries: number }
  | {
      status: "push_failed";
      reason: PushFailureReason;
      sha: string;
      paths: string[];
      retries: number;
      detail: string;
      conflicts: string[];
    };

function identityFlags(identity: BotIdentity): string[] {
  // -c flags keep the bot identity out of any global or repository config. Signing is off because a
  // developer's global gpgsign setting would otherwise make an unattended commit hang or fail.
  return [
    "-c",
    `user.name=${identity.name}`,
    "-c",
    `user.email=${identity.email}`,
    "-c",
    "commit.gpgsign=false",
  ];
}

function pathsOf(changed: readonly ChangedPath[]): string[] {
  const paths = new Set<string>();
  for (const change of changed) {
    paths.add(change.path);
    if (change.originalPath) paths.add(change.originalPath);
  }
  return [...paths].sort();
}

/**
 * Commit only what the command may change, then optionally push. The guard runs first: any change
 * outside the allowlist, or a digest edit that touches more than its audio field, refuses the whole
 * commit and nothing is staged. A rejected push is retried after `git pull --rebase`; a rebase
 * conflict is aborted and reported; the push is never forced.
 */
export async function commitAndPush(input: CommitAndPushInput): Promise<CommitOutcome> {
  const run = input.git ?? createGitRunner(input.root);
  const identity = input.identity ?? identityFromEnv() ?? DEFAULT_BOT;
  const subject = input.message.split("\n", 1)[0] ?? "";
  if (!CONVENTIONAL.test(subject))
    return { status: "refused", reason: "message", offending: [subject] };

  const changed = await readChangedPaths(run);
  if (changed.length === 0) return { status: "nothing_to_commit" };

  // With the config store on (D149), `run` and `podcast` copy the owner's config from it over the
  // config files at their start, and their commit is the snapshot that keeps it in git, so those
  // paths are allowed too, when this run copied them (noted at its start, not read from the switch
  // now). Otherwise the allowlist is exactly ALLOWLISTS.
  const snapshot =
    (input.command === "run" || input.command === "podcast") && (await copiedFromStore(input.root));
  const allowlist = snapshot
    ? [...ALLOWLISTS[input.command], ...CONFIG_DOCUMENT_PATHS]
    : ALLOWLISTS[input.command];
  const offending = findViolations(changed, allowlist);
  if (offending.length === 0 && input.command === "publish") {
    offending.push(...(await findDigestContentViolations({ root: input.root, run, changed })));
  }
  // A half-resolved merge or rebase means the tree is not in a state the bot should commit from.
  offending.push(
    ...changed
      .filter((change) => /U|^AA$|^DD$/.test(change.status))
      .map((change) => `${change.path} (unmerged)`),
  );
  if (offending.length > 0) return { status: "refused", reason: "guard", offending };

  const paths = pathsOf(changed);
  // Only paths with a working-tree difference need staging. Anything git already staged (a
  // `git rm` or `git mv`, whose old path is gone from both tree and index) would make `add` fail.
  const unstaged = changed
    .filter((change) => change.status.charAt(1) !== " ")
    .map((change) => change.path);
  if (unstaged.length > 0) {
    // Literal pathspecs: a file name containing glob characters must not match anything else.
    await gitOutput(run, ["--literal-pathspecs", "add", "-A", "--", ...unstaged]);
  }
  await gitOutput(run, [...identityFlags(identity), "commit", "-m", input.message]);
  const sha = (await gitOutput(run, ["rev-parse", "HEAD"])).trim();

  if (!input.push) return { status: "committed", sha, paths };
  return pushWithRebase({
    run,
    identity,
    remote: "origin",
    maxRetries: DEFAULT_PUSH_RETRIES,
    sha,
    paths,
    snapshot,
  });
}

interface PushInput {
  run: GitRunner;
  identity: BotIdentity;
  remote: string;
  maxRetries: number;
  sha: string;
  paths: string[];
  /** The commit carries a config snapshot from the store (D149). */
  snapshot: boolean;
}

const SNAPSHOT_PATHS: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);

/**
 * A rebase that stopped only on config files this run copied from the store: those files take what
 * the branch already holds (a `learn` push, say), and the rebase goes on. The store, not this copy,
 * is what the next run reads, so the snapshot loses nothing that matters. True when the rebase ended.
 */
async function keepUpstreamConfig(run: GitRunner, identity: BotIdentity): Promise<boolean> {
  for (let step = 0; step < 4; step++) {
    const unmerged = await run(["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = unmerged.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (conflicts.length === 0 || !conflicts.every((path) => SNAPSHOT_PATHS.has(path)))
      return false;
    // In a rebase "ours" is the branch being rebased onto: the remote's copy.
    if ((await run(["checkout", "--ours", "--", ...conflicts])).code !== 0) return false;
    if ((await run(["add", "--", ...conflicts])).code !== 0) return false;
    const next = await run([
      ...identityFlags(identity),
      "-c",
      "core.editor=true",
      "rebase",
      "--continue",
    ]);
    if (next.code === 0) return true;
  }
  return false;
}

async function pushWithRebase(input: PushInput): Promise<CommitOutcome> {
  const { run, remote } = input;
  const failure = (
    reason: PushFailureReason,
    retries: number,
    detail: string,
    sha: string,
    conflicts: string[] = [],
  ): CommitOutcome => ({
    status: "push_failed",
    reason,
    sha,
    paths: input.paths,
    retries,
    detail,
    conflicts,
  });

  const branchResult = await run(["symbolic-ref", "--short", "HEAD"]);
  const branch = branchResult.stdout.trim();
  if (branchResult.code !== 0 || branch === "") {
    return failure(
      "detached_head",
      0,
      "HEAD is not on a branch, so there is nothing to push to",
      input.sha,
    );
  }

  let sha = input.sha;
  for (let retries = 0; ; retries++) {
    // No --force anywhere: a rejected push must be reconciled, never overwritten.
    const pushed = await run(["push", remote, `HEAD:refs/heads/${branch}`]);
    if (pushed.code === 0) return { status: "pushed", sha, paths: input.paths, retries };

    const detail = (pushed.stderr.trim() || pushed.stdout.trim()).split("\n").slice(-3).join(" ");
    if (!NON_FAST_FORWARD.test(pushed.stderr)) return failure("error", retries, detail, sha);
    if (retries >= input.maxRetries) return failure("rejected", retries, detail, sha);

    const pulled = await run([
      ...identityFlags(input.identity),
      "pull",
      "--rebase",
      remote,
      branch,
    ]);
    if (pulled.code !== 0 && input.snapshot && (await keepUpstreamConfig(run, input.identity))) {
      sha = (await gitOutput(run, ["rev-parse", "HEAD"])).trim();
      continue;
    }
    if (pulled.code !== 0) {
      const unmerged = await run(["diff", "--name-only", "--diff-filter=U"]);
      const conflicts = unmerged.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      // Leave the repository as it was before the rebase, with the local commit intact. "No rebase
      // in progress" is fine (the pull failed before one began); any other failure means the
      // repository is stuck mid-rebase and the caller must be told.
      const aborted = await run(["rebase", "--abort"]);
      if (aborted.code !== 0 && !/No rebase in progress/i.test(aborted.stderr)) {
        return failure(
          "error",
          retries,
          `Could not abort the rebase, so the repository is left mid-rebase: ${aborted.stderr.trim()}`,
          sha,
          conflicts,
        );
      }
      const reason: PushFailureReason = conflicts.length > 0 ? "rebase_conflict" : "error";
      return failure(
        reason,
        retries,
        (pulled.stderr.trim() || pulled.stdout.trim()).split("\n").slice(-3).join(" "),
        sha,
        conflicts,
      );
    }
    sha = (await gitOutput(run, ["rev-parse", "HEAD"])).trim();
  }
}
