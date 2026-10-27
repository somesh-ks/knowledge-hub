import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { readRunMetrics } from "../metrics/runMetrics.js";
import { formatReading, type Summary, summarize, WINDOW } from "../metrics/summary.js";
import { readTimings } from "../podcast/timings.js";

const USAGE = "Usage: singularity metrics [--json]";

function formatSummary(summary: Summary): string {
  const stages = (ms: Record<string, number>): string =>
    Object.entries(ms)
      .map(([name, value]) => `${name} ${(value / 1000).toFixed(0)}s`)
      .join(", ") || "none yet";
  return [
    `Briefings (the newest ${WINDOW} of ${summary.briefings.runs} runs)`,
    ...summary.briefings.readings.map((entry) => `  ${formatReading(entry)}`),
    `  median stage times: ${stages(summary.briefings.stage_ms)}`,
    "",
    `Episodes (the newest ${WINDOW} of ${summary.episodes.runs} runs)`,
    ...summary.episodes.readings.map((entry) => `  ${formatReading(entry)}`),
    `  median stage times: ${stages(summary.episodes.stage_ms)}`,
  ].join("\n");
}

/**
 * `singularity metrics`: how healthy generation is, from `state/run-metrics.json` and the episode
 * timings, against the targets in docs/engineering/metrics.md. Offline; changes nothing.
 */
export const run: CommandRun = async (argv, ctx) => {
  try {
    parseArgs({ args: argv, allowPositionals: false, strict: true, options: {} });
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  const [runs, timings] = await Promise.all([readRunMetrics(ctx.root), readTimings(ctx.root)]);
  const summary = summarize({ runs: runs.runs, timings: timings.runs });
  process.stdout.write(`${ctx.json ? JSON.stringify(summary) : formatSummary(summary)}\n`);
  return 0;
};
