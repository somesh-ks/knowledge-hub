import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../context.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import type { SqlClient } from "../store/configPaths.js";
import { type ExperimentFlags, readExperimentFlags } from "../store/experimentFlags.js";

/**
 * The owner's experiment switches as the run saw them at its start (store/experimentFlags.ts), kept
 * in the run's gitignored cache so every stage of the run, each its own process, reads the same
 * answer and a switch flipped mid-run waits for the next one. A loader of an experiment's config
 * file lets this override the file's `enabled`; with no cache, or no entry, the file decides.
 */
export const EXPERIMENT_FLAGS_CACHE = ".cache/experiment-flags.json";

/** Experiment ids, shared with the admin app's registry (apps/admin/src/lib/experiments.ts). */
export const EXPERIMENT_IDS = {
  trustedPublishers: "trusted-publishers",
  communityRanking: "community-ranking",
  alexandria: "alexandria",
} as const;

/** Saves the flags the run starts with; `null` removes a cache left by an earlier run. */
export async function writeExperimentFlagCache(
  root: string,
  flags: ExperimentFlags | null,
): Promise<void> {
  const path = join(root, EXPERIMENT_FLAGS_CACHE);
  if (flags === null) {
    await rm(path, { force: true });
    return;
  }
  // Persisted keys are snake_case, so an experiment id is a value here, not a key.
  const entries = Object.entries(flags).map(([id, flag]) => ({ id, ...flag }));
  await writeFileAtomic(path, `${JSON.stringify({ flags: entries })}\n`);
}

/** The owner's switch for an experiment in this run, or undefined when the config file decides. */
export async function experimentOverride(root: string, id: string): Promise<boolean | undefined> {
  try {
    const text = await readFile(join(root, EXPERIMENT_FLAGS_CACHE), "utf8");
    const { flags } = JSON.parse(text) as { flags: Array<{ id: string; enabled?: unknown }> };
    const flag = flags.find((entry) => entry.id === id);
    return typeof flag?.enabled === "boolean" ? flag.enabled : undefined;
  } catch {
    // No cache, or one that cannot be read: a switch is a convenience, so the file decides.
    return undefined;
  }
}

/**
 * Reads the owner's switches from the store into the cache at a run's start. A store that cannot be
 * read costs the switches, not the run: the config files decide, as they do with the store off.
 */
export async function cacheExperimentFlags(
  root: string,
  sql: SqlClient,
  log: Logger,
): Promise<void> {
  try {
    const flags = await readExperimentFlags(sql);
    await writeExperimentFlagCache(root, flags);
    const set = Object.entries(flags).map(([id, flag]) => `${id} ${flag.enabled ? "on" : "off"}`);
    log.info(`experiment switches: ${set.length === 0 ? "none set" : set.join(", ")}`);
  } catch (error) {
    await writeExperimentFlagCache(root, null).catch(() => {});
    log.warn(`experiment switches unreadable, using the files: ${String(error).split("\n")[0]}`);
  }
}
