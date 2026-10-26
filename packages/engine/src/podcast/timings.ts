import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../state/atomicWrite.js";

/**
 * How long each stage of an episode took, per run, so the page can say how long is left (the
 * status route reads the median of the last 10 runs per stage from the file on main). Written in
 * the publish commit, through the podcast write guard: never by hand.
 */
export const TIMINGS_PATH = "state/podcast-timings.json";
/** Older runs say little about today's speed; the file stays small. */
const KEEP_RUNS = 50;

export interface TimingEntry {
  at: string;
  run_id: string | null;
  format: string;
  length_minutes: number;
  /** Milliseconds per stage id (select, cover, script, publish). A skipped stage has none. */
  stages: Record<string, number>;
}

export interface TimingsFile {
  version: 1;
  runs: TimingEntry[];
}

export async function readTimings(root: string): Promise<TimingsFile> {
  try {
    const file = JSON.parse(await readFile(join(root, TIMINGS_PATH), "utf8")) as TimingsFile;
    return file.version === 1 && Array.isArray(file.runs) ? file : { version: 1, runs: [] };
  } catch {
    return { version: 1, runs: [] };
  }
}

/** Add one run. A run with no timed stage (everything resumed) says nothing and is left out. */
export async function recordTimings(root: string, entry: TimingEntry): Promise<void> {
  if (Object.keys(entry.stages).length === 0) return;
  const file = await readTimings(root);
  const runs = [...file.runs, entry].slice(-KEEP_RUNS);
  await writeFileAtomic(
    join(root, TIMINGS_PATH),
    `${JSON.stringify({ version: 1, runs }, null, 2)}\n`,
  );
}
