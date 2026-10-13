import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  audioTimelineRelPath,
  type DigestId,
  type DigestKind,
  digestRelPath,
  parseDigestFile,
} from "@dispatch/core";
import { commitAndPush } from "../git/commit.js";
import { readSeen, writeSeen } from "../state/store.js";
import { StageFailure, UsageError } from "./errors.js";
import type { PlanPass } from "./plan.js";
import type { DeleteReport, RunDeps, RunMode } from "./types.js";

/** The run mode a digest of this kind was made in, so a replacement is written the same way. */
const MODE_OF_KIND: Record<DigestKind, RunMode> = {
  regular: "scheduled",
  weekly: "weekly",
  "on-demand": "on-demand",
};

/** The pass that replaces digest `id`: its date, its kind and its id, over its own window to now. */
export async function replacementPass(
  deps: RunDeps,
  id: DigestId,
): Promise<{ pass: PlanPass; date: string; mode: RunMode; itemIds: string[] }> {
  let text: string;
  try {
    text = await readFile(join(deps.root, digestRelPath(id)), "utf8");
  } catch {
    throw new UsageError(`--replace ${id}: there is no such digest`);
  }
  const old = parseDigestFile(text);
  return {
    pass: {
      id: old.id,
      kind: old.kind,
      window: { from: old.window.from, to: deps.now().toISOString() },
    },
    date: old.date,
    mode: MODE_OF_KIND[old.kind],
    itemIds: old.items.map((item) => item.id),
  };
}

/**
 * Lets the replaced digest's stories be picked again: the run is asked for the same window, and a
 * story already shown (state/seen.json) is skipped by the fetch. Only the working tree changes;
 * the commit stage writes the seen list of the new digest.
 */
export async function releaseSeen(root: string, itemIds: readonly string[]): Promise<void> {
  const seen = await readSeen(root);
  const items = { ...seen.items };
  for (const itemId of itemIds) delete items[itemId];
  await writeSeen(root, { ...seen, items });
}

/** Removes a digest's file and its narration timeline. The MP3 is overwritten by the next one of this id. */
export async function removeDigestFiles(root: string, id: DigestId): Promise<string[]> {
  const paths = [digestRelPath(id), audioTimelineRelPath(id)];
  for (const rel of paths) await rm(join(root, rel), { force: true });
  return paths;
}

/** `dispatch run --delete <id>`: removes the digest and its timeline in one guarded commit. */
export async function deleteDigest(
  deps: RunDeps,
  id: DigestId,
  options: { dryRun: boolean; noPush: boolean },
): Promise<DeleteReport> {
  try {
    await readFile(join(deps.root, digestRelPath(id)), "utf8");
  } catch {
    throw new UsageError(`--delete ${id}: there is no such digest`);
  }
  if (options.dryRun) {
    return {
      outcome: "deleted",
      id,
      removed: [digestRelPath(id), audioTimelineRelPath(id)],
      dry_run: true,
      commit: "dry_run",
    };
  }
  const removed = await removeDigestFiles(deps.root, id);
  const outcome = await commitAndPush({
    root: deps.root,
    message: `chore(digest): remove ${id}`,
    command: "run",
    push: !options.noPush,
    git: deps.git,
  });
  if (outcome.status === "refused" || outcome.status === "push_failed") {
    throw new StageFailure(`Deleting ${id} did not complete (${outcome.status})`);
  }
  return { outcome: "deleted", id, removed, dry_run: false, commit: outcome.status };
}
