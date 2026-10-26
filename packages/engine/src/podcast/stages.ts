import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "../context.js";
import type { BlobClient } from "../publish/blob.js";
import { writeFileAtomic } from "../state/atomicWrite.js";

/**
 * The stages of an episode, in the order they run. Each is a step of podcast.yml, so the status
 * route can name the one that is running; each leaves an artifact a rerun can pick up. The cover
 * comes before the script: it is chosen from the selection alone, so it is ready while the script
 * is still being written.
 */
export const EPISODE_STAGE_IDS = ["select", "cover", "script", "publish"] as const;
export type EpisodeStageId = (typeof EPISODE_STAGE_IDS)[number];

/** Where a run's artifacts live in Blob, so a rerun (`resume_from`) can read them. */
export const ARTIFACT_PREFIX = "podcast-runs/";
const ARTIFACT_CACHE_SECONDS = 60;
/** How long a Blob read may take before the artifact counts as missing and the stage reruns. */
const READ_TIMEOUT_MS = 10_000;

/** The artifacts of one run: the runner's disk first, then the run being resumed in Blob. */
export interface ArtifactStore {
  read(name: string): Promise<unknown | null>;
  write(name: string, value: unknown): Promise<void>;
  /** Names of the artifacts this run holds, for the failure record. */
  names(): Promise<string[]>;
}

export interface ArtifactStoreInput {
  /** A directory outside the repository (the guard would refuse it in a commit). */
  dir: string;
  /** Mirror of every write, so a failed run's artifacts outlive the runner. Absent: disk only. */
  blob?: BlobClient | null;
  runId: string;
  /** An earlier run whose artifacts this run may reuse. */
  resumeFrom?: string;
  fetchImpl?: typeof fetch;
  log?: Logger;
}

const key = (runId: string, name: string): string => `${ARTIFACT_PREFIX}${runId}/${name}.json`;

export function createArtifactStore(input: ArtifactStoreInput): ArtifactStore {
  const { dir, blob, runId, resumeFrom, log } = input;
  const doFetch = input.fetchImpl ?? fetch;
  const path = (name: string) => join(dir, `${name}.json`);

  async function readDisk(name: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path(name), "utf8"));
    } catch {
      return null;
    }
  }

  async function readResumed(name: string): Promise<unknown | null> {
    if (!blob || !resumeFrom) return null;
    try {
      const wanted = key(resumeFrom, name);
      const page = await blob.list({ prefix: wanted });
      const found = page.blobs.find((item) => item.pathname === wanted);
      if (!found) return null;
      const response = await doFetch(found.url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      return response.ok ? await response.json() : null;
    } catch (error) {
      log?.warn("A saved stage could not be read; it will run again", {
        name,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return null;
    }
  }

  return {
    async read(name) {
      const here = await readDisk(name);
      if (here !== null) return here;
      const earlier = await readResumed(name);
      // Copied to disk, so the later steps of this job find it without another Blob read.
      if (earlier !== null) await this.write(name, earlier);
      return earlier;
    },
    async write(name, value) {
      const text = `${JSON.stringify(value)}\n`;
      await mkdir(dirname(path(name)), { recursive: true });
      await writeFileAtomic(path(name), text);
      if (!blob) return;
      try {
        await blob.put(key(runId, name), new TextEncoder().encode(text), {
          contentType: "application/json",
          cacheControlMaxAge: ARTIFACT_CACHE_SECONDS,
        });
      } catch (error) {
        // The disk copy still serves the later steps of this run; only a rerun loses it.
        log?.warn("A stage's artifact could not be saved to Blob", {
          name,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    },
    async names() {
      const found: string[] = [];
      for (const id of EPISODE_STAGE_IDS) if ((await readDisk(id)) !== null) found.push(id);
      return found;
    },
  };
}

/** What a failed run leaves for the page: the stage that failed and the artifacts that were kept. */
export interface FailureRecord {
  failed_stage: EpisodeStageId;
  kept: string[];
}
