import { parseArgs } from "node:util";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { connectConfigStore, databaseSecrets, type SqlClient } from "../store/configPaths.js";
import { pullState, pushState, seedState } from "../store/stateDocs.js";

const USAGE = `Usage: singularity state <command>

  pull                       Copy each stored state row over its file in state/.
  push                       Write back the state files this job changed, on the row version the
                             pull saw; a row another job moved is merged, or the command stops.
  seed [--dry-run]           Create the state_documents table and add a row for each state file
                             that has none. Never replaces a row.`;

export interface StateDeps {
  /** Opens the database; tests pass a fake. */
  connect?: (databaseUrl: string) => Promise<SqlClient>;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** `singularity state pull|push|seed`: the run state in Postgres (D300 step 3). */
export function makeStateCommand(deps: StateDeps = {}): CommandRun {
  return async (argv: string[], ctx: CommandContext): Promise<number> => {
    const [subcommand, ...rest] = argv;
    if (subcommand === undefined || subcommand === "help" || subcommand === "--help") {
      print(USAGE);
      return subcommand === undefined ? 2 : 0;
    }
    if (subcommand !== "pull" && subcommand !== "push" && subcommand !== "seed") {
      ctx.log.error(`unknown subcommand "${subcommand}"`);
      print(USAGE);
      return 2;
    }
    const url = ctx.env.DATABASE_URL;
    try {
      const { values } = parseArgs({
        args: rest,
        options: { "dry-run": { type: "boolean" } },
        strict: true,
      });
      if (values["dry-run"] === true && subcommand !== "seed") {
        ctx.log.error("--dry-run is only for seed.");
        return 2;
      }
      if (url === undefined || url === "") {
        ctx.log.error("DATABASE_URL is not set.");
        return 1;
      }
      const sql = await (deps.connect ?? connectConfigStore)(url);
      if (subcommand === "pull") {
        const changed = await pullState(ctx.root, sql);
        print(
          ctx.json
            ? JSON.stringify({ ok: true, pulled: changed })
            : `from the store: ${changed.length === 0 ? "nothing" : changed.join(", ")}`,
        );
      } else if (subcommand === "push") {
        const result = await pushState(ctx.root, sql, ctx.log);
        print(
          ctx.json
            ? JSON.stringify({ ok: true, ...result })
            : `written: ${result.written.join(", ") || "nothing"}${result.merged.length > 0 ? `; merged: ${result.merged.join(", ")}` : ""}`,
        );
      } else {
        const inserted = await seedState(ctx.root, sql, { dryRun: values["dry-run"] === true });
        print(
          ctx.json
            ? JSON.stringify({ ok: true, inserted, dry_run: values["dry-run"] === true })
            : `${values["dry-run"] === true ? "would write" : "written"}: ${inserted.join(", ") || "nothing"}`,
        );
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.error(
        redact(message, [...secretsFromEnv(ctx.env), ...(url ? databaseSecrets(url) : [])]),
      );
      const code = (error as NodeJS.ErrnoException).code;
      return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
    }
  };
}

export const run: CommandRun = makeStateCommand();
