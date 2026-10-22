import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILES, Preferences, stockholmDate } from "@dispatch/core";
import { z } from "zod";
import type { CommandContext, CommandRun } from "../context.js";
import { type BotIdentity, type CommitOutcome, commitAndPush } from "../git/commit.js";
import { createGitRunner, gitOutput } from "../git/runGit.js";
import { isBehindRemote, isTreeClean } from "../git/status.js";
import { applyPatch, PreferencesPatch } from "../learn/patch.js";
import {
  type ConfigDocument,
  configStoreUrl,
  connectConfigStore,
  readConfigDocuments,
  type SqlClient,
  writeConfigDocument,
} from "../store/configDocs.js";

/** The store and the stored preferences, or null when the store is off or cannot be reached. */
async function openPreferencesStore(
  ctx: CommandContext,
): Promise<{ sql: SqlClient; stored: ConfigDocument | undefined } | null> {
  const url = configStoreUrl(ctx.env);
  if (url === null) return null;
  try {
    const sql = await connectConfigStore(url);
    const documents = await readConfigDocuments(sql);
    return { sql, stored: documents.find((d) => d.path === CONFIG_FILES.preferences) };
  } catch (error) {
    ctx.log.warn(
      `Config store unreachable, using the file: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

const USAGE = `Usage:
  dispatch learn --schema                 Print the JSON Schema of a preferences patch
  dispatch learn --apply <patch.json>     Apply a patch within the bounds (one stop per weight, three weights)
    [--dry-run]                           Show the diff without writing
    [--commit] [--no-push]                Commit config/preferences.json as chore(prefs): <summary>
                                          and push (--no-push keeps it local). Refuses on a dirty
                                          tree or when behind the remote.`;

function value(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Atomic write with a stable two-space format and trailing newline, so git diffs stay clean. */
function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

const SUBJECT_MAX = 72;

/** Conventional Commit message: a short subject from the changes, then the input and every change. */
export function prefsCommitMessage(input: string, changes: readonly string[]): string {
  const summary =
    changes.length === 1 ? (changes[0] as string) : `${changes.length} changes, ${changes[0]}`;
  const prefix = "chore(prefs): ";
  const subject =
    prefix.length + summary.length <= SUBJECT_MAX
      ? `${prefix}${summary}`
      : `${prefix}${summary.slice(0, SUBJECT_MAX - prefix.length - 3).trimEnd()}...`;
  return `${subject}\n\nInput: ${input}\n\n${changes.map((change) => `- ${change}`).join("\n")}`;
}

/** Why a commit must not start, or null when it may. */
async function commitRefusal(root: string, push: boolean): Promise<string | null> {
  if (!(await isTreeClean(root))) {
    return "The working tree has uncommitted changes. Commit or stash them first: --commit stages config/preferences.json only.";
  }
  if (!push) return null;
  try {
    if (await isBehindRemote(root)) {
      return "The branch is behind its remote. Run git pull --ff-only first.";
    }
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
    return `Cannot reach the remote to check whether the branch is behind (${detail}). Fix the connection, or use --no-push.`;
  }
  return null;
}

/** The git identity of whoever runs this, when both parts are set; otherwise the bot default applies. */
async function committerIdentity(root: string): Promise<BotIdentity | undefined> {
  const git = createGitRunner(root);
  try {
    const name = (await gitOutput(git, ["config", "user.name"])).trim();
    const email = (await gitOutput(git, ["config", "user.email"])).trim();
    return name !== "" && email !== "" ? { name, email } : undefined;
  } catch {
    return undefined;
  }
}

function describeCommit(outcome: CommitOutcome): { ok: boolean; line: string } {
  switch (outcome.status) {
    case "nothing_to_commit":
      return { ok: true, line: "Nothing to commit." };
    case "committed":
      return { ok: true, line: `Committed ${outcome.sha.slice(0, 7)} (not pushed).` };
    case "pushed":
      return { ok: true, line: `Committed and pushed ${outcome.sha.slice(0, 7)}.` };
    case "refused":
      return {
        ok: false,
        line: `Commit refused (${outcome.reason}): ${outcome.offending.join(", ")}`,
      };
    case "push_failed":
      return {
        ok: false,
        line: `Committed ${outcome.sha.slice(0, 7)} but the push failed (${outcome.reason}): ${outcome.detail}`,
      };
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled commit outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

export const run: CommandRun = async (argv, ctx) => {
  if (argv.includes("--schema")) {
    console.log(JSON.stringify(z.toJSONSchema(PreferencesPatch), null, 2));
    return 0;
  }
  const patchPath = value(argv, "--apply");
  if (!patchPath) {
    console.error(USAGE);
    return 2;
  }
  const commit = argv.includes("--commit");
  const noPush = argv.includes("--no-push");
  if ((noPush && !commit) || (commit && argv.includes("--dry-run"))) {
    console.error("--no-push needs --commit, and --commit cannot be combined with --dry-run.");
    console.error(USAGE);
    return 2;
  }
  const prefsPath = join(ctx.root, CONFIG_FILES.preferences);
  // With the config store on (D149) the stored preferences are the current ones, not the file. A
  // store that cannot be reached is a warning, as at the start of a run: the file is used.
  const store = await openPreferencesStore(ctx);
  const current = Preferences.parse(
    JSON.parse(store?.stored?.content ?? readFileSync(prefsPath, "utf8")),
  );
  let patchJson: unknown;
  try {
    patchJson = JSON.parse(readFileSync(patchPath, "utf8"));
  } catch (error) {
    ctx.log.error(
      `Cannot read the patch at ${patchPath}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return 1;
  }
  const parsed = PreferencesPatch.safeParse(patchJson);
  if (!parsed.success) {
    // One line per problem, so the caller sees which field to fix instead of a truncated message.
    for (const issue of parsed.error.issues) {
      ctx.log.error(`Invalid patch at ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return 1;
  }
  const patch = parsed.data;

  const { next, changes, clamped } = applyPatch(current, patch, stockholmDate(ctx.now()));
  if (changes.length === 0) {
    ctx.log.info("No changes: the patch matched the current preferences.");
    return 0;
  }
  for (const line of changes) console.log(`+ ${line}`);
  for (const line of clamped) ctx.log.warn(`Clamped: ${line}`);

  if (argv.includes("--dry-run")) return 0;
  if (commit) {
    // Checked before anything is written, so a refusal leaves the tree exactly as it was.
    const refusal = await commitRefusal(ctx.root, !noPush);
    if (refusal) {
      ctx.log.error(refusal);
      return 1;
    }
  }
  // The store first, on the version read: a run copies it over the file, so a weight written only
  // to the file would be undone, and an edit made in the app since the read must not be lost.
  if (store !== null) {
    try {
      const written = await writeConfigDocument(
        store.sql,
        CONFIG_FILES.preferences,
        `${JSON.stringify(next, null, 2)}\n`,
        store.stored?.version ?? null,
      );
      if (!written) {
        ctx.log.error(
          "The stored preferences changed while learn ran (an edit in the app). Nothing was written; run learn again.",
        );
        return 1;
      }
    } catch (error) {
      ctx.log.warn(
        `Config store unreachable, writing the file only: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  writeJson(prefsPath, next);
  if (!commit) {
    ctx.log.info(
      `Updated ${CONFIG_FILES.preferences}. Review the diff, then commit as "chore(prefs): ...".`,
    );
    return 0;
  }
  const identity = await committerIdentity(ctx.root);
  const outcome = await commitAndPush({
    root: ctx.root,
    message: prefsCommitMessage(patch.input, changes),
    command: "learn",
    push: !noPush,
    ...(identity ? { identity } : {}),
  });
  const { ok, line } = describeCommit(outcome);
  if (ok) ctx.log.info(line);
  else ctx.log.error(line);
  return ok ? 0 : 1;
};
