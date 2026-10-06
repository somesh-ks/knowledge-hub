import { execFile } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs git in a fixed directory. Never throws for a non-zero exit; the caller reads `code`. */
export type GitRunner = (args: readonly string[]) => Promise<GitResult>;

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A git runner rooted at `cwd`. Output is forced to the C locale so the stderr text the push logic
 * matches does not depend on the machine's language, and prompts are disabled so a missing
 * credential fails instead of hanging a workflow.
 */
export function createGitRunner(cwd: string): GitRunner {
  return (args) =>
    new Promise<GitResult>((resolve, reject) => {
      execFile(
        "git",
        [...args],
        {
          cwd,
          encoding: "utf8",
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
          env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" },
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ code: 0, stdout, stderr });
          } else if (typeof error.code === "number") {
            resolve({ code: error.code, stdout, stderr });
          } else {
            reject(error);
          }
        },
      );
    });
}

export class GitError extends Error {
  readonly args: readonly string[];
  readonly code: number;

  constructor(args: readonly string[], result: GitResult) {
    super(
      `git ${args[0] ?? ""} failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.name = "GitError";
    this.args = args;
    this.code = result.code;
  }
}

/** Run git and return stdout, throwing a GitError on a non-zero exit. */
export async function gitOutput(run: GitRunner, args: readonly string[]): Promise<string> {
  const result = await run(args);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}
