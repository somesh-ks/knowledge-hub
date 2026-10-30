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

/** Where a failed run's artifacts live in Blob, so a rerun (`resume_from`) can read them. */
export const ARTIFACT_PREFIX = "podcast-runs/";
/** The one object a failed run leaves: the failure record and every artifact the run kept. */
export const FAILURE_FILE = "failure";
const ARTIFACT_CACHE_SECONDS = 60;
/** How long a Blob read may take before the artifact counts as missing and the stage reruns. */
const READ_TIMEOUT_MS = 10_000;

/** The artifacts of one run: the runner's disk first, then the failed run being resumed in Blob. */
export interface ArtifactStore {
  read(name: string): Promise<unknown | null>;
  /** Kept on the runner's disk, which the steps of one job share. Nothing goes to Blob here. */
  write(name: string, value: unknown): Promise<void>;
  /**
   * Saves the failure record, the stages kept (`kept`) and every artifact as one Blob object, so a
   * rerun can resume.
   * Called only when the run fails: a put is one of Hobby's 2,000 advanced operations a month, and
   * a run that succeeds has no use for its artifacts (D256).
   */
  preserve(failure: Record<string, unknown>): Promise<void>;
}

export interface ArtifactStoreInput {
  /** A directory outside the repository (the guard would refuse it in a commit). */
  dir: string;
  /** Where a failed run's artifacts are saved. Absent: disk only. */
  blob?: BlobClient | null;
  runId: string;
  /** An earlier run whose artifacts this run may reuse. */
  resumeFrom?: string;
  fetchImpl?: typeof fetch;
  log?: Logger;
}

const key = (runId: string, name: string): string => `${ARTIFACT_PREFIX}${runId}/${name}.json`;

/** Files on disk that belong in the pack besides the stages: how long each stage took. */
const EXTRA_ARTIFACTS = ["timings"] as const;

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

  // The failed run's pack, read once: every stage of the rerun asks for its own artifact.
  let resumed: Promise<Record<string, unknown>> | undefined;
  async function loadResumed(): Promise<Record<string, unknown>> {
    if (!blob || !resumeFrom) return {};
    try {
      const wanted = key(resumeFrom, FAILURE_FILE);
      const page = await blob.list({ prefix: wanted });
      const found = page.blobs.find((item) => item.pathname === wanted);
      if (!found) return {};
      const response = await doFetch(found.url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
      if (!response.ok) {
        log?.warn("The failed run's saved stages could not be fetched; they will run again", {
          status: response.status,
        });
        return {};
      }
      const artifacts = (await response.json())?.artifacts;
      if (typeof artifacts === "object" && artifacts !== null) return artifacts;
      log?.warn("The failed run's saved pack has no stages; they will run again");
      return {};
    } catch (error) {
      log?.warn("The failed run's saved stages could not be read; they will run again", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return {};
    }
  }

  return {
    async read(name) {
      const here = await readDisk(name);
      if (here !== null) return here;
      resumed ??= loadResumed();
      const earlier = (await resumed)[name] ?? null;
      // Copied to disk, so the later steps of this job find it without another Blob read.
      if (earlier !== null) await this.write(name, earlier);
      return earlier;
    },
    async write(name, value) {
      await mkdir(dirname(path(name)), { recursive: true });
      await writeFileAtomic(path(name), `${JSON.stringify(value)}\n`);
    },
    async preserve(failure) {
      if (!blob) return;
      // A stage this run skipped and never read is still in the failed run's pack: carry it on, so
      // a second failure does not lose what the first one kept.
      resumed ??= loadResumed();
      const earlier = await resumed;
      const artifacts: Record<string, unknown> = {};
      for (const name of [...EPISODE_STAGE_IDS, ...EXTRA_ARTIFACTS]) {
        const value = (await readDisk(name)) ?? earlier[name] ?? null;
        if (value !== null) artifacts[name] = value;
      }
      const kept = EPISODE_STAGE_IDS.filter((id) => id in artifacts);
      try {
        await blob.put(
          key(runId, FAILURE_FILE),
          new TextEncoder().encode(`${JSON.stringify({ ...failure, kept, artifacts })}\n`),
          { contentType: "application/json", cacheControlMaxAge: ARTIFACT_CACHE_SECONDS },
        );
      } catch (error) {
        // The page then names no stage and a rerun starts over; the run's own failure is the news.
        log?.warn("The failed run's stages could not be saved to Blob", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  };
}

/** What a failed run leaves for the page: the stage that failed and the artifacts that were kept. */
export interface FailureRecord {
  failed_stage: EpisodeStageId;
  kept: string[];
}
