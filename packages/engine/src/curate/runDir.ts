import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `.cache/run/<id>/`. The id may not contain path separators, so a run cannot escape the cache. */
export function runDirFor(root: string, runId: string): string {
  if (!RUN_ID.test(runId)) {
    throw new Error(`Invalid run id "${runId}". Use letters, digits, dot, dash and underscore.`);
  }
  return join(root, ".cache", "run", runId);
}

/** Resolve a user-supplied path against the repository root. */
export function fromRoot(root: string, path: string): string {
  return resolve(root, path);
}

/** The file that marks a directory as a run for a given command: curate reads the pool, render the selection. */
export type RunMarker = "pool.json" | "selection.json";

/** The run directory whose `marker` file was written most recently, or null when there is none. */
export async function findLatestRunDir(
  root: string,
  marker: RunMarker = "pool.json",
): Promise<string | null> {
  const base = join(root, ".cache", "run");
  let names: string[];
  try {
    names = await readdir(base);
  } catch {
    return null;
  }
  let best: { dir: string; mtime: number } | null = null;
  for (const name of names) {
    try {
      const info = await stat(join(base, name, marker));
      if (best === null || info.mtimeMs > best.mtime) {
        best = { dir: join(base, name), mtime: info.mtimeMs };
      }
    } catch {
      // not a run directory with that file
    }
  }
  return best?.dir ?? null;
}

export interface RunLocation {
  runDir: string;
  poolPath: string;
}

/**
 * Find a run's directory and pool. `run` names `.cache/run/<id>`; `pool` names the pool file
 * (and, without `run`, its folder is the run directory); with neither, the newest run that has
 * the marker file is used: the pool `singularity fetch` just wrote, or the selection `dispatch
 * curate` just wrote when `marker` is "selection.json".
 */
export async function resolveRunLocation(
  root: string,
  args: { run?: string | undefined; pool?: string | undefined },
  marker: RunMarker = "pool.json",
): Promise<RunLocation> {
  if (args.run) {
    const runDir = runDirFor(root, args.run);
    return { runDir, poolPath: args.pool ? fromRoot(root, args.pool) : join(runDir, "pool.json") };
  }
  if (args.pool) {
    const poolPath = fromRoot(root, args.pool);
    return { runDir: dirname(poolPath), poolPath };
  }
  const latest = await findLatestRunDir(root, marker);
  if (latest === null) {
    throw new Error(
      marker === "pool.json"
        ? "No pool found under .cache/run. Run `singularity fetch` first, or pass --run or --pool."
        : "No selection found under .cache/run. Run `singularity curate` first, or pass --run or --selection.",
    );
  }
  return { runDir: latest, poolPath: join(latest, "pool.json") };
}
