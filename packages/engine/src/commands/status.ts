import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { collectStatus, formatStatus } from "../ops/statusReport.js";

const USAGE = "Usage: dispatch status [--json]";

/** `dispatch status`: last runs, next due date, audio, failing sources and budget, from the repo files. */
export const run: CommandRun = async (argv, ctx) => {
  try {
    parseArgs({ args: argv, allowPositionals: false, strict: true, options: {} });
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  const report = await collectStatus(ctx.root, ctx.now(), ctx.env.SPEECHIFY_MONTHLY_CHARS);
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatStatus(report)}\n`);
  return 0;
};
