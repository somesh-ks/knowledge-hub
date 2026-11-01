#!/usr/bin/env tsx
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Env, loadEnv, repoRoot } from "@singularity/core";
import { COMMANDS, type CommandSpec } from "./commandRegistry.js";
import {
  type CommandContext,
  type CommandRun,
  createLogger,
  type Logger,
  redact,
  secretsFromEnv,
} from "./context.js";
import { cacheExperimentFlags, writeExperimentFlagCache } from "./experiments/overrides.js";
import {
  configStoreUrl,
  connectConfigStore,
  hydrateConfig,
  readsConfigAtStart,
  type SqlClient,
} from "./store/configDocs.js";
import { missingConfigFiles, REQUIRED_CONFIG_DOCUMENTS } from "./store/configExamples.js";

/** Where the CLI prints and what it reads, so tests drive it without touching the process. */
export interface CliIo {
  /** Opens the config store when DATABASE_URL is set (D149). Tests pass a fake. */
  connectConfigStore?: (databaseUrl: string) => Promise<SqlClient>;
  /** Working directory the repository root is found from. */
  cwd?: string;
  /** Environment variables. Defaults to the process environment plus the repository's .env. */
  env?: Record<string, string | undefined>;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Replace the command table, for tests. */
  commands?: readonly CommandSpec[];
}

interface ParsedArgs {
  command: string | undefined;
  rest: string[];
  json: boolean;
  root: string | undefined;
  help: boolean;
}

class UsageProblem extends Error {}

/**
 * Global flags may sit anywhere on the line, because the workflows put `--json` after the
 * command (`singularity run --stage gate --json`). They are removed before the command sees its
 * own arguments, so commands never need to know about them.
 */
export function splitArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: undefined,
    rest: [],
    json: false,
    root: undefined,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageProblem("--root needs a path");
      }
      parsed.root = value;
      index += 1;
    } else if (arg.startsWith("--root=")) parsed.root = arg.slice("--root=".length);
    else if (arg === "--" && parsed.command === undefined && parsed.rest.length === 0) continue;
    else if (parsed.command === undefined && !arg.startsWith("-")) parsed.command = arg;
    else parsed.rest.push(arg);
  }
  if (parsed.root === "") throw new UsageProblem("--root needs a path");
  return parsed;
}

export function topLevelHelp(commands: readonly CommandSpec[] = COMMANDS): string {
  const width = Math.max(...commands.map((command) => command.name.length));
  const lines = commands.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return `Singularity: a private design-engineering news podcast.

Usage: singularity <command> [args] [--json] [--root <path>]

Commands:
${lines.join("\n")}

Global flags:
  --json         machine-readable JSON on stdout (logs always go to stderr)
  --root <path>  repository root (default: the git top level of the current directory)
  --help, -h     this list, or the help of a command: singularity <command> --help

Exit codes: 0 success, 1 failure, 2 usage error.`;
}

function loadProcessEnvFile(root: string): void {
  try {
    // Variables already set in the environment win over the file, so CI secrets are never replaced.
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env file, or one that cannot be read: the environment alone supplies the keys.
  }
}

/** Secrets the typed env does not list but that must never reach a log. */
const EXTRA_SECRET_NAMES = [
  "VERCEL_TOKEN",
  "GITHUB_SINGULARITY_TOKEN",
  "GITHUB_DISPATCH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
] as const;

function allSecrets(env: Env, source: Record<string, string | undefined>): string[] {
  const extra = EXTRA_SECRET_NAMES.map((name) => source[name]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return [...secretsFromEnv(env), ...extra];
}

function quietDebug(log: Logger, source: Record<string, string | undefined>): Logger {
  if (source.SINGULARITY_DEBUG === "1" || source.DISPATCH_DEBUG === "1") return log;
  return { ...log, debug: () => {} };
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

/**
 * Run the CLI and return the exit code. 2 is a usage error (unknown command, bad flags), 1 a
 * failed command, 0 success. A failure prints one line that has passed the secret redactor.
 */
export async function runCli(argv: readonly string[], io: CliIo = {}): Promise<number> {
  const out = io.stdout ?? ((text: string) => void process.stdout.write(text));
  const err = io.stderr ?? ((text: string) => void process.stderr.write(text));
  const commands = io.commands ?? COMMANDS;

  let parsed: ParsedArgs;
  try {
    parsed = splitArgs(argv);
  } catch (error) {
    err(`singularity: ${error instanceof Error ? error.message : "invalid arguments"}\n`);
    return 2;
  }

  if (parsed.command === undefined) {
    if (parsed.help) {
      out(`${topLevelHelp(commands)}\n`);
      return 0;
    }
    err(`${topLevelHelp(commands)}\n`);
    return 2;
  }
  const spec = commands.find((command) => command.name === parsed.command);
  if (spec === undefined) {
    err(
      `singularity: unknown command "${parsed.command}". Run "singularity --help" for the list.\n`,
    );
    return 2;
  }
  if (parsed.help) {
    out(`${spec.help}\n`);
    return 0;
  }

  const cwd = io.cwd ?? process.cwd();
  let root: string;
  try {
    root = parsed.root === undefined ? repoRoot(cwd) : resolve(cwd, parsed.root);
  } catch {
    err(
      "singularity: not inside a git repository. Run it from the repository or pass --root <path>.\n",
    );
    return 1;
  }
  if (!existsSync(root)) {
    err(`singularity: --root ${parsed.root ?? root} does not exist\n`);
    return 2;
  }

  // The repository's .env feeds a local run; the process environment (CI) takes precedence.
  if (io.env === undefined) loadProcessEnvFile(root);
  const source = io.env ?? process.env;
  let env: Env;
  try {
    env = loadEnv(source);
  } catch (error) {
    const issues =
      error instanceof Error && "issues" in error
        ? (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues
            .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
            .join("; ")
        : "invalid value";
    err(`singularity: invalid environment (${issues})\n`);
    return 1;
  }
  const secrets = allSecrets(env, source);
  const log = quietDebug(
    createLogger({ json: parsed.json, secrets, write: (line) => err(`${line}\n`) }),
    source,
  );
  const ctx: CommandContext = {
    root,
    env,
    log,
    json: parsed.json,
    now: io.now ?? (() => new Date()),
  };

  // The owner's config lives in Postgres, not in git (D296): it is copied over the config files
  // before the command reads them. The switch is separate from the URL, which `vercel env pull`
  // also writes to a local .env. A database that cannot be reached stops the command when a config
  // file is missing (a checkout has none), so no briefing is made from defaults the owner did not
  // choose; a machine that still holds its own copy of the files uses them and says so.
  if (readsConfigAtStart(spec.name, parsed.rest)) {
    const storeUrl = configStoreUrl(env);
    // Switches saved by an earlier run on this machine must not outlive its read: a store that then
    // fails would leave them in charge. A cache that cannot be removed stops the run.
    const cleared = await writeExperimentFlagCache(root, null).then(
      () => true,
      () => false,
    );
    if (!cleared) {
      err(
        "singularity: .cache/experiment-flags.json cannot be removed; remove it, then run again.\n",
      );
      return 1;
    }
    if (storeUrl !== null) {
      try {
        const sql = await (io.connectConfigStore ?? connectConfigStore)(storeUrl);
        const { changed, usable } = await hydrateConfig(root, sql, log);
        log.info(`config store: ${changed.length === 0 ? "files current" : changed.join(", ")}`);
        await cacheExperimentFlags(root, sql, log);
        // A store that answers but lacks (or holds unusable) a required document would leave the
        // loaders on defaults, or on a stale file, the owner never chose: stop, as for a store that
        // is down. The file on disk does not count; only the row does.
        const lacking = REQUIRED_CONFIG_DOCUMENTS.filter((path) => !usable.includes(path));
        if (lacking.length > 0 && spec.name !== "health") {
          err(
            `singularity: the config store has no usable ${lacking.join(", ")}. Run config pull, then config seed, then edit it in the app (or fix the row).\n`,
          );
          return 1;
        }
      } catch (error) {
        const reason = redact(firstLine(String(error)), secrets);
        const missing = await missingConfigFiles(root);
        if (missing.length > 0 && spec.name !== "health") {
          err(
            `singularity: the config store cannot be read (${reason}) and the owner's config is not in git. Missing: ${missing.join(", ")}.\n`,
          );
          return 1;
        }
        log.warn(`config store unreachable, using the files here: ${reason}`);
      }
    } else {
      // Store off (a fork, or a production run whose switch went missing): a checkout holds no
      // owner config, and a run on the loaders' defaults is not the owner's briefing.
      const missing = await missingConfigFiles(root);
      if (missing.length > 0 && spec.name !== "health") {
        err(
          `singularity: config/ is missing ${missing.join(", ")} and the config store is off. Run: npm run singularity -- config pull\n`,
        );
        return 1;
      }
    }
  }

  let run: CommandRun;
  try {
    run = await spec.load();
  } catch (error) {
    err(`singularity: could not load ${spec.name}: ${redact(firstLine(String(error)), secrets)}\n`);
    return 1;
  }
  try {
    return await run(parsed.rest, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err(`singularity: ${spec.name} failed: ${redact(firstLine(message), secrets)}\n`);
    return 1;
  }
}

/** Wait for a stream to flush, so exiting right after a large write cannot truncate it. */
function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((done) => {
    stream.write("", () => done());
  });
}

async function main(): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(
      `singularity: unexpected error: ${firstLine(reason instanceof Error ? reason.message : String(reason))}\n`,
    );
    process.exitCode = 1;
  });
  const code = await runCli(process.argv.slice(2));
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
