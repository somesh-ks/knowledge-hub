import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, parseConfigOps, SourcesUserFile, STATE_FILES } from "@dispatch/core";
import {
  applyConfigOp,
  type ConfigBundle,
  ConfigOpError,
  type OpOutcome,
  tidy,
} from "../config/applyOp.js";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { loadPreferences } from "../curate/inputs.js";
import { loadQueries, QUERIES_PATH } from "../fetch/queries.js";
import { commitAndPush } from "../git/commit.js";
import { createGitRunner } from "../git/runGit.js";
import { createHttpClient, type HttpClient } from "../http.js";
import { loadSchedule, serializeSchedule } from "../schedule/store.js";
import { loadSources, loadUserSources, serializeUserSources } from "../sources/registry.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { stableStringify } from "../state/stableJson.js";
import { readSourceCandidates } from "../state/store.js";
import { loadTopics, serializeTopics } from "../topics/store.js";
import { loadWriter, serializeWriter } from "../writer/store.js";

const USAGE = `Usage: dispatch config <command>

  apply --op '<json>' [--dry-run]    Apply a change to the topics, sources, queries, weights or schedule.
                                     The op is one object or an array of 1 to 8; an array is checked
                                     whole, applied in order and lands all or nothing. Network only
                                     for source.add (feed lookup).
  commit --message <text> [--no-push]
                                     Commit the files apply may change as chore(config): <text>
                                     and push. The write guard refuses anything else.

Ops (see ConfigOp in @dispatch/core):
  {"op":"topic.upsert","topic":{"name":"...","description":"...","keywords":["..."]}}
  {"op":"topic.remove","id":"..."}
  {"op":"source.add","url":"https://...","topic_ids":["..."]}
  {"op":"source.set","id":"...","enabled":false,"pinned":true}
  {"op":"source.remove","id":"..."}
  {"op":"weights.set","weights":{"topic_id":0.8}}
  {"op":"schedule.set","hour":7,"cadence_days":2,"sections":null}
  {"op":"writer.set","provider":"nebius","model":null}`;

export interface ConfigDeps {
  /** Network client for source.add. Tests pass a fake. */
  http?: HttpClient;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Same format `dispatch learn` writes, so preferences diffs stay small. */
function serializePreferences(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function serializeQueries(file: ConfigBundle["queries"]): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

async function readBundle(root: string): Promise<ConfigBundle> {
  const preferences = await loadPreferences(root);
  const [topics, schedule, writer, sourcesUser, registry, queries, candidates] = await Promise.all([
    loadTopics(root, preferences),
    loadSchedule(root),
    loadWriter(root),
    loadUserSources(root),
    loadSources(root),
    loadQueries(root),
    readSourceCandidates(root),
  ]);
  return { topics, preferences, schedule, writer, sourcesUser, registry, queries, candidates };
}

/** What each file would contain, in the form it is committed in. */
function renderBundle(bundle: ConfigBundle): Record<string, string> {
  return {
    [CONFIG_FILES.topics]: serializeTopics(bundle.topics),
    [CONFIG_FILES.preferences]: serializePreferences(bundle.preferences),
    [CONFIG_FILES.schedule]: serializeSchedule(bundle.schedule),
    [CONFIG_FILES.writer]: serializeWriter(bundle.writer),
    [CONFIG_FILES.sourcesUser]: serializeUserSources(SourcesUserFile.parse(bundle.sourcesUser)),
    [QUERIES_PATH]: serializeQueries(bundle.queries),
    [STATE_FILES.sourceCandidates]: stableStringify(bundle.candidates),
  };
}

/**
 * `dispatch config apply|commit`. `apply` validates one op, applies it in memory, and writes
 * only the files whose content changed. `commit` commits those files through the write guard,
 * whose allowlist for this command names exactly them. Exit codes: 0 done, 1 failure, 2 usage.
 */
export function makeConfigCommand(deps: ConfigDeps = {}): CommandRun {
  return async (argv: string[], ctx: CommandContext): Promise<number> => {
    const [subcommand, ...rest] = argv;
    try {
      switch (subcommand) {
        case "apply":
          return await runApply(rest, ctx, deps);
        case "commit":
          return await runCommit(rest, ctx);
        case undefined:
          print(USAGE);
          return 2;
        case "help":
        case "--help":
        case "-h":
          print(USAGE);
          return 0;
        default:
          ctx.log.error(`unknown subcommand "${subcommand}"`);
          print(USAGE);
          return 2;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log.error(redact(message, secretsFromEnv(ctx.env)));
      const code = (error as NodeJS.ErrnoException).code;
      return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
    }
  };
}

async function runApply(argv: string[], ctx: CommandContext, deps: ConfigDeps): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { op: { type: "string" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  if (values.op === undefined) {
    print(USAGE);
    return 2;
  }
  let json: unknown;
  try {
    json = JSON.parse(values.op);
  } catch {
    ctx.log.error("--op is not valid JSON.");
    return 1;
  }
  const parsed = parseConfigOps(json);
  if (!parsed.success) {
    // One line per problem, so the caller sees which field to fix.
    for (const issue of parsed.issues) {
      ctx.log.error(`Invalid op at ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return 1;
  }

  // Every op was validated above. They now apply in order to one in-memory bundle, so an op can
  // rely on an earlier one (a source hinted to a topic created just before it), and nothing is
  // written unless all of them succeed.
  const before = await readBundle(ctx.root);
  const outcomes: OpOutcome[] = [];
  let current = before;
  const discover = { http: deps.http ?? createHttpClient({ retries: 1 }) };
  for (const [index, op] of parsed.data.entries()) {
    try {
      const outcome = await applyConfigOp(op, current, { discover });
      outcomes.push(outcome);
      current = outcome.next;
    } catch (error) {
      if (error instanceof ConfigOpError) {
        ctx.log.error(
          parsed.data.length === 1
            ? error.message
            : `Op ${index + 1} of ${parsed.data.length}: ${error.message}`,
        );
        return 1;
      }
      throw error;
    }
  }
  const outcome = combineOutcomes(outcomes);

  const was = renderBundle(before);
  const now = renderBundle(outcome.next);
  const changed: string[] = [];
  for (const [path, text] of Object.entries(now)) {
    // Only what the op itself changed is written. A file the op left alone keeps its exact bytes,
    // and one that does not exist yet is not created just to hold defaults.
    if (text === was[path]) continue;
    if ((await readText(join(ctx.root, path))) !== text) changed.push(path);
  }
  if (!values["dry-run"]) {
    for (const path of changed) await writeFileAtomic(join(ctx.root, path), now[path] as string);
  }

  const commitMessage = `chore(config): ${tidy(outcome.summary, 56)}`;
  const report = {
    ok: true,
    op: parsed.data.length === 1 ? (parsed.data[0]?.op ?? "batch") : "batch",
    ops: parsed.data.length,
    summary: outcome.summary,
    commit_message: commitMessage,
    ...(outcome.topic_id ? { topic_id: outcome.topic_id } : {}),
    new_topic: outcome.new_topic === true,
    files: changed,
    dry_run: values["dry-run"] === true,
  };
  print(
    ctx.json
      ? JSON.stringify(report)
      : `${outcome.summary}${changed.length === 0 ? " (no change)" : `: ${changed.join(", ")}`}`,
  );
  return 0;
}

/**
 * One outcome for a batch, for the report and the commit subject. A single op keeps its own
 * summary. Several name the topic when one was created (the usual case: a topic and its sources),
 * and otherwise count the changes. The topic id is the first one an op touched, and a new topic
 * anywhere in the batch counts as new so the workflow still looks for suggestions.
 */
export function combineOutcomes(outcomes: readonly OpOutcome[]): OpOutcome {
  const last = outcomes[outcomes.length - 1] as OpOutcome;
  if (outcomes.length === 1) return last;
  const created = outcomes.find((outcome) => outcome.new_topic === true);
  const touched = created ?? outcomes.find((outcome) => outcome.topic_id !== undefined);
  const others = outcomes.filter((outcome) => outcome !== created);
  const sources = others.filter((outcome) => outcome.summary.startsWith("add source")).length;
  let summary: string;
  if (created && sources === others.length) {
    summary = `${created.summary} with ${sources} source${sources === 1 ? "" : "s"}`;
  } else if (!created && sources === outcomes.length) {
    summary = `add ${sources} sources`;
  } else {
    summary = `${outcomes.length} config changes`;
  }
  return {
    next: last.next,
    summary,
    ...(touched?.topic_id ? { topic_id: touched.topic_id } : {}),
    ...(created ? { new_topic: true } : {}),
  };
}

async function runCommit(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { message: { type: "string" }, "no-push": { type: "boolean" } },
    strict: true,
  });
  if (!values.message) {
    print(USAGE);
    return 2;
  }
  const message = /^[a-z]+(\([^)]*\))?!?: /.test(values.message)
    ? values.message
    : `chore(config): ${values.message}`;
  const outcome = await commitAndPush({
    root: ctx.root,
    message,
    command: "config",
    push: !values["no-push"],
    git: createGitRunner(ctx.root),
  });
  switch (outcome.status) {
    case "nothing_to_commit":
      print(ctx.json ? JSON.stringify({ status: outcome.status }) : "Nothing to commit.");
      return 0;
    case "committed":
    case "pushed":
      print(
        ctx.json
          ? JSON.stringify({ status: outcome.status, sha: outcome.sha, paths: outcome.paths })
          : `${outcome.status === "pushed" ? "Committed and pushed" : "Committed"} ${outcome.sha.slice(0, 7)}.`,
      );
      return 0;
    case "refused":
      ctx.log.error(`Commit refused (${outcome.reason}): ${outcome.offending.join(", ")}`);
      return 1;
    case "push_failed":
      ctx.log.error(
        `Committed ${outcome.sha.slice(0, 7)} but the push failed (${outcome.reason}): ${outcome.detail}`,
      );
      return 1;
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled commit outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

export const run: CommandRun = makeConfigCommand();
