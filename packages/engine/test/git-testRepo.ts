import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serializeDigestFile } from "@dispatch/core";
import type { GitResult, GitRunner } from "../src/git/runGit.js";
import { createGitRunner } from "../src/git/runGit.js";
import { digestFor } from "./audio-fixtures.js";

/** Plain git for test setup. Identity is passed per command so the repos hold no config of their own. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test Author",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

export async function put(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function commitAll(root: string, message: string): Promise<string> {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

export const SEED_DIGEST_ID = "2026-10-05";
export const SEED_DIGEST_PATH = `Digests/2026/10/${SEED_DIGEST_ID}.md`;

export interface RepoPair {
  /** Bare repository acting as origin. */
  remote: string;
  /** Two clones of it, as two writers would have. */
  a: string;
  b: string;
  cleanup(): Promise<void>;
}

// Building a pair runs about eight git processes; each worker builds one template per kind and
// copies it per test, which gives every test the same fresh, independent pair for a file copy.
const templates = new Map<string, Promise<string>>();
const templateDirs: string[] = [];
process.once("exit", () => {
  for (const dir of templateDirs) rmSync(dir, REMOVE);
});

/** Windows holds a file open for a moment after git exits (antivirus, indexer): retry on EBUSY. */
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const;

/** Build a template once per worker and key, then hand out copies of it. */
export async function templatePair(key: string, build: () => Promise<string>): Promise<RepoPair> {
  let template = templates.get(key);
  if (!template) {
    template = build().then((dir) => {
      templateDirs.push(dir);
      return dir;
    });
    templates.set(key, template);
  }
  return copyPair(await template);
}

/** Copy a pair's directory and point both clones at the copied remote. */
async function copyPair(template: string): Promise<RepoPair> {
  const base = await mkdtemp(join(tmpdir(), "dispatch-git-"));
  await cp(template, base, { recursive: true });
  const remote = join(base, "remote.git");
  const a = join(base, "a");
  const b = join(base, "b");
  git(a, "remote", "set-url", "origin", remote);
  git(b, "remote", "set-url", "origin", remote);
  return { remote, a, b, cleanup: () => rm(base, REMOVE) };
}

/** A bare remote with the same seed commit pushed to `main` and two clones of it. */
export function createRepoPair(options: { seedDigest?: boolean } = {}): Promise<RepoPair> {
  const seedDigest = options.seedDigest !== false;
  return templatePair(`pair:${seedDigest}`, async () => {
    const pair = await buildRepoPair(seedDigest);
    return dirname(pair.remote);
  });
}

async function buildRepoPair(seedDigest: boolean): Promise<RepoPair> {
  const base = await mkdtemp(join(tmpdir(), "dispatch-git-tpl-"));
  const remote = join(base, "remote.git");
  const a = join(base, "a");
  const b = join(base, "b");
  git(base, "init", "-q", "--bare", "--initial-branch=main", remote);
  // autocrlf is off from the first checkout: a Windows default of "true" would rewrite line endings
  // in one clone and make unrelated commits look like conflicts.
  git(base, "clone", "-q", "-c", "core.autocrlf=false", remote, a);
  git(a, "checkout", "-q", "-b", "main");
  if (seedDigest) {
    await put(a, SEED_DIGEST_PATH, serializeDigestFile(digestFor(SEED_DIGEST_ID)));
  }
  await put(
    a,
    "state/usage.json",
    '{\n  "version": 1,\n  "speechify": { "month": "2026-10", "characters": 0 }\n}\n',
  );
  await put(a, "state/seen.json", '{ "version": 1, "items": {} }\n');
  await put(a, "config/preferences.json", "{}\n");
  await put(a, "package.json", "{}\n");
  await commitAll(a, "chore: seed");
  git(a, "push", "-q", "-u", "origin", "main");
  git(base, "clone", "-q", "-c", "core.autocrlf=false", remote, b);
  return { remote, a, b, cleanup: () => rm(base, REMOVE) };
}

export interface SpyRunner {
  run: GitRunner;
  calls: string[][];
  /** Calls whose first non-option argument is `subcommand`. */
  of(subcommand: string): string[][];
}

/** Real git with every call recorded; `intercept` may answer a call instead of running it. */
export function spyRunner(
  cwd: string,
  intercept?: (args: readonly string[]) => GitResult | undefined,
): SpyRunner {
  const real = createGitRunner(cwd);
  const calls: string[][] = [];
  const subcommandOf = (args: readonly string[]): string | undefined => {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "-c") index++;
      else if (arg !== undefined && !arg.startsWith("-")) return arg;
    }
    return undefined;
  };
  return {
    calls,
    run: async (args) => {
      calls.push([...args]);
      return intercept?.(args) ?? real(args);
    },
    of: (subcommand) => calls.filter((call) => subcommandOf(call) === subcommand),
  };
}

export function localGitConfig(cwd: string, key: string): string {
  try {
    return git(cwd, "config", "--local", key);
  } catch {
    return "";
  }
}
