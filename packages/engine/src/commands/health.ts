import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { collectHealth, formatHealth, type WorkflowRun } from "../ops/health.js";

const USAGE =
  "Usage: dispatch health [--offline] [--site <origin>] [--ceiling-usd <n>] [--runs <gh-run-list.json>] [--perf <perf.json>] [--json]";
const DEFAULT_SITE = "https://news.someshks.work";
/** About three full runs a day: more in 24 hours is a loop or a runaway retry. */
const DEFAULT_CEILING_USD = 5;

/** `dispatch health`: faults in runs, narration, data, cost and the live site; exits 1 on a fault. */
export const run: CommandRun = async (argv, ctx) => {
  let values: {
    offline?: boolean;
    site?: string;
    "ceiling-usd"?: string;
    runs?: string;
    perf?: string;
  };
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        offline: { type: "boolean" },
        site: { type: "string" },
        "ceiling-usd": { type: "string" },
        runs: { type: "string" },
        perf: { type: "string" },
      },
    }).values;
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  const ceilingUsd = Number(values["ceiling-usd"] ?? DEFAULT_CEILING_USD);
  const site = values.offline ? null : (values.site ?? DEFAULT_SITE).replace(/\/+$/, "");
  if (!(ceilingUsd > 0) || (site !== null && !/^https?:\/\/[^/]+$/.test(site))) {
    ctx.log.error(USAGE);
    return 2;
  }
  // run.yml's recent runs, as `gh run list --json databaseId,status,conclusion,createdAt,event,displayTitle`
  // wrote them (health.yml), for `run_died` and `run_cancelled`. A file that does not read is a usage error.
  let runs: WorkflowRun[] | undefined;
  if (values.runs !== undefined) {
    try {
      const parsed: unknown = JSON.parse(await readFile(values.runs, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("not a list");
      runs = parsed as WorkflowRun[];
    } catch (error) {
      ctx.log.error(`--runs: ${error instanceof Error ? error.message : "unreadable"}. ${USAGE}`);
      return 2;
    }
  }
  // scripts/perfProbe.ts's output. A probe that failed wrote no file: that reads as unmeasured
  // (a warning), never a usage error, so the rest of the check still runs.
  let perf: unknown;
  if (values.perf !== undefined) {
    perf = await readFile(values.perf, "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
  }
  const report = await collectHealth({
    root: ctx.root,
    now: ctx.now(),
    monthlyChars: ctx.env.SPEECHIFY_MONTHLY_CHARS,
    ceilingUsd,
    site,
    ...(runs ? { runs } : {}),
    ...(values.perf !== undefined ? { perf } : {}),
    voices: {
      SPEECHIFY_VOICE_ID: ctx.env.SPEECHIFY_VOICE_ID,
      SPEECHIFY_VOICE_ID_B: ctx.env.SPEECHIFY_VOICE_ID_B,
    },
  });
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatHealth(report)}\n`);
  return report.ok ? 0 : 1;
};
