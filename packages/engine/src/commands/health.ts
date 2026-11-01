import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { collectHealth, formatHealth, type WorkflowRun } from "../ops/health.js";
import {
  readDeploymentCount,
  readStore,
  readWatchedHead,
  SIDE_WORKFLOWS,
  type SideWorkflow,
} from "../ops/healthChecks.js";
import { configStoreUrl } from "../store/configPaths.js";

/** What the checks read from a run: a malformed entry in a hand-made file fails the command, not a check. */
const isRun = (value: unknown): value is WorkflowRun => {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.databaseId === "number" &&
    typeof run.status === "string" &&
    typeof run.createdAt === "string" &&
    Number.isFinite(Date.parse(run.createdAt)) &&
    (run.conclusion === null || typeof run.conclusion === "string")
  );
};

const USAGE =
  "Usage: singularity health [--offline] [--site <origin>] [--ceiling-usd <n>] [--runs <gh-run-list.json>] [--side-runs <json>] [--perf <perf.json>] [--json]";
const DEFAULT_SITE = "https://news.someshks.work";
/** About three full runs a day: more in 24 hours is a loop or a runaway retry. */
const DEFAULT_CEILING_USD = 5;

/**
 * `singularity health`: faults in runs, narration, data, cost, the live site and its field Web Vitals;
 * exits 1 on a fault.
 */
export const run: CommandRun = async (argv, ctx) => {
  let values: {
    offline?: boolean;
    site?: string;
    "ceiling-usd"?: string;
    runs?: string;
    "side-runs"?: string;
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
        "side-runs": { type: "string" },
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
      if (!parsed.every(isRun)) throw new Error("an entry is not a workflow run");
      runs = parsed;
    } catch (error) {
      ctx.log.error(`--runs: ${error instanceof Error ? error.message : "unreadable"}. ${USAGE}`);
      return 2;
    }
  }
  // The same listing for content.yml, ingest.yml and podcast.yml, as {"content": [...], ...}.
  let sideRuns: Partial<Record<SideWorkflow, WorkflowRun[]>> | undefined;
  if (values["side-runs"] !== undefined) {
    try {
      const parsed: unknown = JSON.parse(await readFile(values["side-runs"], "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("not an object of lists");
      }
      // A key the check does not know (a typo for `content`) would silently turn that check off.
      const unknown = Object.keys(parsed).filter(
        (key) => !(SIDE_WORKFLOWS as readonly string[]).includes(key),
      );
      if (unknown.length > 0) throw new Error(`unknown workflow ${unknown.join(", ")}`);
      sideRuns = {};
      for (const workflow of SIDE_WORKFLOWS) {
        const list = (parsed as Record<string, unknown>)[workflow];
        if (list === undefined) continue;
        if (!Array.isArray(list)) throw new Error(`${workflow} is not a list`);
        if (!list.every(isRun)) throw new Error(`an entry of ${workflow} is not a workflow run`);
        // A podcast request is told apart by its title: without one, a newer success would clear any failure.
        if (workflow === "podcast" && !list.every((run) => run.displayTitle))
          throw new Error("an entry of podcast has no displayTitle");
        sideRuns[workflow] = list;
      }
    } catch (error) {
      ctx.log.error(
        `--side-runs: ${error instanceof Error ? error.message : "unreadable"}. ${USAGE}`,
      );
      return 2;
    }
  }
  // scripts/perfProbe.ts's output. A probe that failed wrote no file: that reads as unmeasured
  // (a warning), never a usage error, so the rest of the check still runs. An empty path is a day
  // the probe did not run (health.yml probes on Mondays, D148): no performance is judged.
  const perfPath = values.perf || undefined;
  let perf: unknown;
  if (perfPath) {
    perf = await readFile(perfPath, "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
  }
  // The Neon store, read over the network like the site: field Web Vitals (D156), the shared rate
  // counter and, with the config store switched on (D149), its documents.
  // With them, the newest commit Vercel would deploy, for `site_behind` (health.yml fetches history).
  const [store, main] =
    site === null
      ? [undefined, undefined]
      : await Promise.all([
          readStore(ctx.env.DATABASE_URL, ctx.now(), {
            configStore: configStoreUrl(ctx.env) !== null,
          }),
          readWatchedHead(ctx.root),
        ]);
  // Hobby's 100 deployments a day, read from Vercel when a token is set (D247).
  const deployments =
    site === null ? undefined : await readDeploymentCount(ctx.env.VERCEL_TOKEN, ctx.now());
  const report = await collectHealth({
    root: ctx.root,
    now: ctx.now(),
    monthlyChars: ctx.env.SPEECHIFY_MONTHLY_CHARS,
    ceilingUsd,
    site,
    ...(runs ? { runs } : {}),
    ...(sideRuns ? { sideRuns } : {}),
    ...(perfPath ? { perf } : {}),
    ...(store ? { store } : {}),
    ...(main ? { main } : {}),
    ...(deployments ? { deployments } : {}),
    voices: {
      SPEECHIFY_VOICE_ID: ctx.env.SPEECHIFY_VOICE_ID,
      SPEECHIFY_VOICE_ID_B: ctx.env.SPEECHIFY_VOICE_ID_B,
    },
  });
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatHealth(report)}\n`);
  return report.ok ? 0 : 1;
};
