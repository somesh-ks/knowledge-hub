import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { collectHealth, formatHealth } from "../ops/health.js";

const USAGE = "Usage: dispatch health [--offline] [--site <origin>] [--ceiling-usd <n>] [--json]";
const DEFAULT_SITE = "https://news.someshks.work";
/** About three full runs a day: more in 24 hours is a loop or a runaway retry. */
const DEFAULT_CEILING_USD = 5;

/** `dispatch health`: faults in runs, narration, data, cost and the live site; exits 1 on a fault. */
export const run: CommandRun = async (argv, ctx) => {
  let values: { offline?: boolean; site?: string; "ceiling-usd"?: string };
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        offline: { type: "boolean" },
        site: { type: "string" },
        "ceiling-usd": { type: "string" },
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
  const report = await collectHealth({
    root: ctx.root,
    now: ctx.now(),
    monthlyChars: ctx.env.SPEECHIFY_MONTHLY_CHARS,
    ceilingUsd,
    site,
  });
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatHealth(report)}\n`);
  return report.ok ? 0 : 1;
};
