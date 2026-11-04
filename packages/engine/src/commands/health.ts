import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";
import { DAILY_CEILING_USD } from "../cost/ceiling.js";
import { freeKeyChecks } from "../ops/doctorOnline.js";
import { collectHealth, formatHealth, type WorkflowRun } from "../ops/health.js";
import { readGitHub, readNeonCompute } from "../ops/healthBudgets.js";
import {
  readDeploymentCount,
  readStore,
  readWatchedHead,
  SIDE_WORKFLOWS,
  type SideWorkflow,
} from "../ops/healthChecks.js";
import { configStoreUrl, connectConfigStore, databaseSecrets } from "../store/configPaths.js";
import { saveHealthReport } from "../store/healthStore.js";

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
  "Usage: singularity health [--offline] [--site <origin>] [--ceiling-usd <n>] [--runs <gh-run-list.json>] [--side-runs <json>] [--perf <perf.json>] [--save] [--json]";
const DEFAULT_SITE = "https://news.someshks.work";
/** Each key check's request, as long as doctor's online checks wait. */
const KEY_TIMEOUT_MS = 12_000;
/** About three full runs a day: more in 24 hours is a loop or a runaway retry. */

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
    save?: boolean;
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
        save: { type: "boolean" },
      },
    }).values;
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  const ceilingUsd = Number(values["ceiling-usd"] ?? DAILY_CEILING_USD);
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
  // The budgets (D360): Neon's compute hours, the week on GitHub and the keys that cost nothing to try.
  const secrets = [
    ...secretsFromEnv(ctx.env),
    ...[ctx.env.GITHUB_SINGULARITY_TOKEN, ctx.env.GITHUB_DISPATCH_TOKEN, ctx.env.GH_TOKEN].filter(
      (value): value is string => value !== undefined,
    ),
  ];
  const [neon, github, keys] =
    site === null
      ? [undefined, undefined, undefined]
      : await Promise.all([
          readNeonCompute(ctx.env.NEON_API_KEY, ctx.env.NEON_PROJECT_ID, ctx.now()),
          readGitHub(ctx.env.GH_TOKEN, ctx.env.GITHUB_REPOSITORY, ctx.now()),
          freeKeyChecks(ctx.env, { fetchImpl: fetch, timeoutMs: KEY_TIMEOUT_MS }, secrets),
        ]);
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
    ...(neon ? { neon } : {}),
    ...(github ? { github } : {}),
    ...(keys ? { keys } : {}),
    ...(site === null ? {} : { configStore: configStoreUrl(ctx.env) !== null }),
    voices: {
      SPEECHIFY_VOICE_ID: ctx.env.SPEECHIFY_VOICE_ID,
      SPEECHIFY_VOICE_ID_B: ctx.env.SPEECHIFY_VOICE_ID_B,
    },
  });
  // The Health page reads the newest report from Neon: health.yml passes --save, a local run does not.
  if (values.save && ctx.env.DATABASE_URL) {
    const url = ctx.env.DATABASE_URL;
    try {
      await saveHealthReport(await connectConfigStore(url), report);
    } catch (error) {
      report.findings.push({
        code: "health_unsaved",
        aspect: "integrity",
        severity: "warning",
        message: `The report was not saved for the Health page: ${redact(error instanceof Error ? error.message : String(error), databaseSecrets(url))}.`,
      });
    }
  }
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : formatHealth(report)}\n`);
  return report.ok ? 0 : 1;
};
