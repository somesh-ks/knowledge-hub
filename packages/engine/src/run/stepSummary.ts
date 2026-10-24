import { appendFile } from "node:fs/promises";
import { formatReport } from "./format.js";
import type { PipelineResult, StageName } from "./types.js";

/**
 * Markdown for the GitHub job summary: the same counts, ids and outcome the text report prints.
 * It never carries fetched text, item text or error details beyond the one-line stage failure.
 */
export function formatStepSummary(
  stage: StageName | "run",
  report: PipelineResult["report"],
): string {
  return `### singularity ${stage === "run" ? "run" : `run --stage ${stage}`}\n\n\`\`\`text\n${formatReport(report)}\n\`\`\`\n`;
}

/**
 * Append a stage's summary to the file GitHub names in GITHUB_STEP_SUMMARY, when it is set.
 * A summary that cannot be written never fails the run.
 */
export async function appendStepSummary(
  path: string | undefined,
  stage: StageName | "run",
  report: PipelineResult["report"],
): Promise<void> {
  if (path === undefined || path === "") return;
  try {
    await appendFile(path, `${formatStepSummary(stage, report)}\n`, "utf8");
  } catch {
    // The run log already has everything; the summary is a convenience.
  }
}
