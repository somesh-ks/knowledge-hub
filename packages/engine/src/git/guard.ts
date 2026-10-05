import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDigestFile } from "@dispatch/core";
import type { GitRunner } from "./runGit.js";
import { gitOutput } from "./runGit.js";

export type GitCommand = "run" | "publish" | "learn";

/**
 * Where each bot command may write. An entry ending in "/" allows everything beneath it; "*" matches
 * within one path segment and "**" across segments. `publish` may also rewrite a digest's audio
 * field, which `findDigestContentViolations` checks beyond the path.
 */
export const ALLOWLISTS: Record<GitCommand, readonly string[]> = {
  run: ["Digests/", "state/"],
  publish: ["Digests/**/*.audio.json", "Digests/**/*.md", "state/usage.json"],
  learn: ["config/preferences.json"],
};

/** One line of `git status --porcelain`: the path, and the old path when git saw a rename or copy. */
export interface ChangedPath {
  /** Two-character status such as " M", "R ", "D " or "??". */
  status: string;
  path: string;
  originalPath?: string;
}

export class GuardViolationError extends Error {
  readonly offending: string[];

  constructor(offending: string[], allowlist: readonly string[]) {
    super(`Changes outside the write allowlist (${allowlist.join(", ")}): ${offending.join(", ")}`);
    this.name = "GuardViolationError";
    this.offending = offending;
  }
}

const OCTAL = /^[0-7]{3}$/;

/** Undo git's C-style quoting of unusual paths, including octal-escaped UTF-8 bytes. */
function unquote(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const inner = raw.slice(1, -1);
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
  for (let index = 0; index < inner.length; index++) {
    const char = inner.charAt(index);
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const octal = inner.slice(index + 1, index + 4);
    if (OCTAL.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 3;
      continue;
    }
    const escaped = inner.charAt(index + 1);
    bytes.push(...Buffer.from(simple[escaped] ?? escaped, "utf8"));
    index += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

function hasRenameOrCopy(status: string): boolean {
  return /[RC]/.test(status);
}

/**
 * Parse `git status --porcelain` output into changed paths. Accepts both the NUL-separated form
 * (`-z`, which never quotes and lists the new path before the old one) and the line form.
 */
export function parsePorcelain(output: string): ChangedPath[] {
  const changes: ChangedPath[] = [];
  if (output.includes("\0")) {
    const parts = output.split("\0");
    for (let index = 0; index < parts.length; index++) {
      const entry = parts[index] ?? "";
      if (entry.length < 4) continue;
      const status = entry.slice(0, 2);
      const path = entry.slice(3);
      if (hasRenameOrCopy(status)) {
        index += 1;
        changes.push({ status, path, originalPath: parts[index] ?? "" });
      } else {
        changes.push({ status, path });
      }
    }
    return changes;
  }
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (hasRenameOrCopy(status) && arrow >= 0) {
      changes.push({
        status,
        path: unquote(rest.slice(arrow + 4)),
        originalPath: unquote(rest.slice(0, arrow)),
      });
    } else {
      changes.push({ status, path: unquote(rest) });
    }
  }
  return changes;
}

/** Every change in the working tree and index, untracked files included, one entry per file. */
export async function readChangedPaths(run: GitRunner): Promise<ChangedPath[]> {
  return parsePorcelain(await gitOutput(run, ["status", "--porcelain", "-z", "-uall"]));
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern.charAt(index);
    if (char === "*" && pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && pattern.charAt(index + 1) === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when `path` (repo-relative) is covered by the allowlist. Escapes from the repo never are. */
export function isPathAllowed(path: string, allowlist: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
    return false;
  if (normalized.split("/").includes("..")) return false;
  return allowlist.some((entry) =>
    entry.endsWith("/") ? normalized.startsWith(entry) : globToRegExp(entry).test(normalized),
  );
}

/** Paths in `changed` that the allowlist does not cover. A rename counts both its ends. */
export function findViolations(
  changed: readonly (ChangedPath | string)[],
  allowlist: readonly string[],
): string[] {
  const offending = new Set<string>();
  for (const entry of changed) {
    const paths =
      typeof entry === "string"
        ? [entry]
        : [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])];
    for (const path of paths) {
      if (!isPathAllowed(path, allowlist)) offending.add(path);
    }
  }
  return [...offending];
}

/** Throw a GuardViolationError listing every path outside the allowlist. */
export function assertPathsAllowed(
  changed: readonly (ChangedPath | string)[],
  allowlist: readonly string[],
): void {
  const offending = findViolations(changed, allowlist);
  if (offending.length > 0) throw new GuardViolationError(offending, allowlist);
}

function isMarkdownDigest(path: string): boolean {
  return path.startsWith("Digests/") && path.endsWith(".md");
}

/** A modification in either column and nothing else: not an add, delete, rename or untracked file. */
function isPlainModification(status: string): boolean {
  return /^[ M]{2}$/.test(status) && status !== "  ";
}

export interface DigestContentCheck {
  root: string;
  run: GitRunner;
  changed: readonly ChangedPath[];
}

/**
 * Enforce the "audio field rewrite only" half of the publish allowlist: every changed digest must
 * be an edit of an existing file whose frontmatter matches HEAD apart from `audio`. Returns the
 * offending paths, empty when the changes are clean.
 */
export async function findDigestContentViolations(check: DigestContentCheck): Promise<string[]> {
  const offending: string[] = [];
  for (const change of check.changed) {
    if (!isMarkdownDigest(change.path)) continue;
    if (!isPlainModification(change.status)) {
      offending.push(`${change.path} (a digest may be edited, not added, removed or renamed)`);
      continue;
    }
    try {
      const before = parseDigestFile(await gitOutput(check.run, ["show", `HEAD:${change.path}`]));
      const after = parseDigestFile(await readFile(join(check.root, change.path), "utf8"));
      if (!isDeepStrictEqual({ ...before, audio: null }, { ...after, audio: null })) {
        offending.push(`${change.path} (changes more than the audio field)`);
      }
    } catch {
      offending.push(`${change.path} (could not be compared with HEAD)`);
    }
  }
  return offending;
}
