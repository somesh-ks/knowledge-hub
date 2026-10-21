import { parseArgs } from "node:util";
import { buildReport, type GroupBy, type Period } from "@dispatch/core";
import type { CommandRun } from "../context.js";
import { loadAllCosts } from "../cost/ledger.js";
import { formatCostReport } from "../cost/report.js";
import { loadScheduleZone } from "../schedule/store.js";

const USAGE =
  "Usage: dispatch costs [--period day|week|month] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by provider|kind|timezone|user|product|scope] [--tz <zone>] [--json]";
const PERIODS = ["day", "week", "month"];
const GROUPS = ["provider", "kind", "timezone", "user", "product", "scope"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `dispatch costs`: the cost ledger totalled by period, grouped, with per-run and per-user averages. */
export const run: CommandRun = async (argv, ctx) => {
  let values: ReturnType<typeof parse>;
  try {
    values = parse(argv);
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  const { period = "day", from, to, by, tz } = values;
  if (
    !PERIODS.includes(period) ||
    (by !== undefined && !GROUPS.includes(by)) ||
    (from !== undefined && !DATE.test(from)) ||
    (to !== undefined && !DATE.test(to))
  ) {
    ctx.log.error(USAGE);
    return 2;
  }
  const timeZone = tz ?? (await loadScheduleZone(ctx.root));
  const report = buildReport(await loadAllCosts(ctx.root), {
    period: period as Period,
    timeZone,
    from,
    to,
    groupBy: by as GroupBy | undefined,
  });
  process.stdout.write(
    `${ctx.json ? JSON.stringify({ version: 1, time_zone: timeZone, ...report }) : formatCostReport(report, timeZone)}\n`,
  );
  return 0;
};

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      period: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      by: { type: "string" },
      tz: { type: "string" },
    },
  }).values;
}
