import { parseArgs } from "node:util";
import type { CommandContext, CommandRun } from "../context.js";
import { RUN_MODES, type RunMode } from "../gate/decideRun.js";
import { buildDeps } from "../run/buildDeps.js";
import { formatReport } from "../run/format.js";
import { runPipeline } from "../run/pipeline.js";
import {
  DEFAULT_RUN_OPTIONS,
  isStageName,
  type RunDeps,
  type RunOptions,
  STAGES,
} from "../run/types.js";
import { RUN_USAGE } from "../run/usage.js";

function parseOptions(argv: string[]): { options: RunOptions; help: boolean } {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      mode: { type: "string" },
      force: { type: "boolean" },
      since: { type: "string" },
      "dry-run": { type: "boolean" },
      "no-push": { type: "boolean" },
      stage: { type: "string" },
      run: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const mode = values.mode ?? DEFAULT_RUN_OPTIONS.mode;
  if (!(RUN_MODES as readonly string[]).includes(mode)) {
    throw new Error(`--mode must be one of ${RUN_MODES.join(", ")}, not "${mode}"`);
  }
  if (values.stage !== undefined && !isStageName(values.stage)) {
    throw new Error(`--stage must be one of ${STAGES.join(", ")}, not "${values.stage}"`);
  }
  if (values.run !== undefined && values.stage !== "commit") {
    throw new Error("--run only applies with --stage commit");
  }
  return {
    help: values.help === true,
    options: {
      mode: mode as RunMode,
      force: values.force === true,
      since: values.since,
      dryRun: values["dry-run"] === true,
      noPush: values["no-push"] === true,
      stage: values.stage === undefined ? undefined : (values.stage as RunOptions["stage"]),
      run: values.run,
    },
  };
}

/**
 * `dispatch run`: the staged pipeline the workflows call. The command only parses flags and
 * prints; `runPipeline` holds the logic and takes every dependency as a parameter.
 */
export function makeRunCommand(
  createDeps: (ctx: CommandContext) => RunDeps = buildDeps,
): CommandRun {
  return async (argv, ctx) => {
    let parsed: ReturnType<typeof parseOptions>;
    try {
      parsed = parseOptions(argv);
    } catch (error) {
      ctx.log.error(error instanceof Error ? error.message : "invalid arguments");
      process.stderr.write(`${RUN_USAGE}\n`);
      return 2;
    }
    if (parsed.help) {
      process.stdout.write(`${RUN_USAGE}\n`);
      return 0;
    }

    const result = await runPipeline(createDeps(ctx), parsed.options);
    if ("outcome" in result.report && result.report.outcome === "failed") {
      const failed = result.report;
      const detail = "error" in failed ? `${failed.stage} failed: ${failed.error}` : failed.reason;
      ctx.log.error(detail ?? "the run failed");
    }
    process.stdout.write(
      `${ctx.json ? JSON.stringify(result.report) : formatReport(result.report)}\n`,
    );
    return result.code;
  };
}

export const run: CommandRun = makeRunCommand();
