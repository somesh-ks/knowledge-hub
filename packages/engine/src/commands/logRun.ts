import { parseArgs } from "node:util";
import type { CommandRun } from "../context.js";
import { buildEpisodeRunRecord } from "../podcast/runLog.js";
import { buildRunRecord, type JobResult } from "../run/runLog.js";
import { connectConfigStore, databaseSecrets, type SqlClient } from "../store/configPaths.js";
import { recordPipelineRun } from "../store/runsStore.js";

const USAGE =
  "Usage: singularity log-run --result <success|failure|cancelled> [--outcome <published|nothing>]\n       singularity log-run --workflow podcast --result <...> --request <json> --artifacts <dir> [--started-at <iso>]";
const RESULTS: readonly string[] = ["success", "failure", "cancelled"];

/**
 * `singularity log-run`: run.yml's last step (D220). Writes the run that just ended, with the time
 * and cost of each stage, to Neon's `pipeline_runs` and `pipeline_stages`, whatever its end: a dry
 * run, a failure and a cancel too. A log that cannot be written (no DATABASE_URL, Neon down, no
 * plan) says so and exits 0, because a measurement must never fail the run it measures.
 * `--workflow podcast` logs a Catch up or its regeneration (podcast.yml) from the stage artifacts.
 */
export function makeLogRunCommand(
  connect: (databaseUrl: string) => Promise<SqlClient> = connectConfigStore,
): CommandRun {
  return async (argv, ctx) => {
    let values: {
      result?: string;
      outcome?: string;
      workflow?: string;
      request?: string;
      artifacts?: string;
      "started-at"?: string;
    };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          result: { type: "string" },
          outcome: { type: "string" },
          workflow: { type: "string" },
          request: { type: "string" },
          artifacts: { type: "string" },
          "started-at": { type: "string" },
        },
      }).values;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    const podcast = values.workflow === "podcast";
    if (
      !values.result ||
      !RESULTS.includes(values.result) ||
      (values.workflow !== undefined && values.workflow !== "run" && !podcast) ||
      (podcast && (values.request === undefined || values.artifacts === undefined))
    ) {
      ctx.log.error(USAGE);
      return 2;
    }
    const databaseUrl = ctx.env.DATABASE_URL;
    if (!databaseUrl) {
      ctx.log.warn("DATABASE_URL is not set: the run was not logged to Neon");
      return 0;
    }
    try {
      const record = podcast
        ? await buildEpisodeRunRecord({
            root: ctx.root,
            request: values.request ?? "",
            artifacts: values.artifacts ?? "",
            now: ctx.now(),
            startedAt: values["started-at"],
            result: values.result as JobResult,
            githubRunId: process.env.GITHUB_RUN_ID,
          })
        : await buildRunRecord({
            root: ctx.root,
            now: ctx.now(),
            result: values.result as JobResult,
            outcome: values.outcome ?? "",
            githubRunId: process.env.GITHUB_RUN_ID,
          });
      if (!record) {
        ctx.log.warn("There is no run to log (no plan, or a delete)");
        return 0;
      }
      await recordPipelineRun(await connect(databaseUrl), record);
      process.stdout.write(
        `${ctx.json ? JSON.stringify({ logged: record.run_id, outcome: record.outcome }) : `Logged run ${record.run_id} (${record.outcome}).`}\n`,
      );
    } catch (error) {
      let reason = error instanceof Error ? error.message : String(error);
      for (const secret of databaseSecrets(databaseUrl))
        reason = reason.split(secret).join("[redacted]");
      ctx.log.warn("The run was not logged to Neon", { reason });
    }
    return 0;
  };
}

export const run: CommandRun = makeLogRunCommand();
