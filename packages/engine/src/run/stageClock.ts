import { join } from "node:path";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { runCacheDir } from "./plan.js";

/**
 * `.cache/run/stage-ms.json`: how long each stage of the run in progress took, kept between the
 * workflow's steps (each its own process) so the commit stage can put the whole run's timing in
 * `state/run-metrics.json`. A stage that runs twice (a resume) adds its time. A write that fails
 * never fails the run: the numbers are a convenience.
 */
const StageClockFile = z.object({
  version: z.literal(1),
  /** The plan's `created_at`; a file from another run is ignored. */
  run: z.string(),
  stages: z.record(z.string(), z.number().nonnegative()),
  /** The stage that failed and why, in a sentence, for the failed run's record. */
  failure: z.object({ stage: z.string(), reason: z.string() }).optional(),
});
type StageClockFile = z.infer<typeof StageClockFile>;

const clockPath = (root: string): string => join(runCacheDir(root), "stage-ms.json");

/** Return this run's stage clock, or an empty clock for missing, invalid or another run's data. */
export async function readStageClock(root: string, run: string): Promise<StageClockFile> {
  const empty: StageClockFile = { version: 1, run, stages: {} };
  try {
    const raw = await readJsonIfExists(clockPath(root), "stage-ms.json");
    const parsed = raw === null ? null : StageClockFile.safeParse(raw);
    return parsed?.success && parsed.data.run === run ? parsed.data : empty;
  } catch {
    return empty;
  }
}

/** Add rounded, nonnegative elapsed milliseconds to this run's stage total; ignore I/O failures. */
export async function addStageTime(
  root: string,
  run: string,
  stage: string,
  elapsedMs: number,
): Promise<void> {
  try {
    const clock = await readStageClock(root, run);
    clock.stages[stage] = (clock.stages[stage] ?? 0) + Math.max(0, Math.round(elapsedMs));
    await writeJson(clockPath(root), clock);
  } catch {
    // The run goes on without its timing.
  }
}

/** Save the latest failed stage and up to 280 characters of its reason; ignore I/O failures. */
export async function noteStageFailure(
  root: string,
  run: string,
  stage: string,
  reason: string,
): Promise<void> {
  try {
    const clock = await readStageClock(root, run);
    await writeJson(clockPath(root), {
      ...clock,
      failure: { stage, reason: reason.slice(0, 280) },
    });
  } catch {
    // As above.
  }
}
