import { join, resolve } from "node:path";
import { type DigestKind, stockholmDate } from "@dispatch/core";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Default run id: the Stockholm date and the kind, for example `2026-10-07-regular`. */
export function defaultRunId(now: Date, kind: DigestKind): string {
  return `${stockholmDate(now)}-${kind}`;
}

/** `.cache/run/<id>/`. The id may not contain path separators, so a run cannot escape the cache. */
export function runDirFor(root: string, runId: string): string {
  if (!RUN_ID.test(runId))
    throw new Error(`Invalid run id "${runId}". Use letters, digits, dot, dash and underscore.`);
  return join(root, ".cache", "run", runId);
}

/** Resolve a user-supplied path against the repository root. */
export function fromRoot(root: string, path: string): string {
  return resolve(root, path);
}
