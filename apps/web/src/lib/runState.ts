import { join } from "node:path";
import { LastRunFile, type Outcome, STATE_FILES } from "@singularity/core";
import { type ContentFiles, diskFiles } from "./contentFiles";

/** What the site needs from state/last-run.json: the newest run of any kind. */
export interface LastRunSummary {
  outcome: Outcome | null;
  at: string | null;
  digestId: string | null;
}

export const NO_RUN: LastRunSummary = { outcome: null, at: null, digestId: null };

/** The most recent record among scheduled, weekly and on-demand runs. */
export function summarizeLastRun(file: LastRunFile | null): LastRunSummary {
  if (!file) return NO_RUN;
  const records = [file.regular, file.weekly, file.on_demand].filter(
    (record) => record !== undefined,
  );
  const newest = records.sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (!newest) return NO_RUN;
  return { outcome: newest.outcome, at: newest.at, digestId: newest.digest_id ?? null };
}

/** Reads state/last-run.json under `root`. A missing or unreadable file means no run is known. */
export async function readLastRun(
  root: string,
  reader: ContentFiles = diskFiles,
): Promise<LastRunSummary> {
  try {
    const raw = await reader.read(join(root, STATE_FILES.lastRun));
    if (raw === null) return NO_RUN;
    return summarizeLastRun(LastRunFile.parse(JSON.parse(raw)));
  } catch {
    return NO_RUN;
  }
}
