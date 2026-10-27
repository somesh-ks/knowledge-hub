import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILES, Preferences, stockholmDate } from "@singularity/core";
import { z } from "zod";
import type { CommandContext, CommandRun } from "../context.js";
import { type BotIdentity, type CommitOutcome, commitAndPush } from "../git/commit.js";
import { createGitRunner, gitOutput } from "../git/runGit.js";
import { isAheadOfRemote, isBehindRemote, isTreeClean } from "../git/status.js";
import { applyPatch, PreferencesPatch } from "../learn/patch.js";
import {
  type ConfigDocument,
  configStoreUrl,
  connectConfigStore,
  readConfigDocuments,
  type SqlClient,
  writeConfigDocument,
} from "../store/configDocs.js";

type Connect = (databaseUrl: string) => Promise<SqlClient>;

/**
 * The store and the stored preferences; null when the store is off, "unreachable" when it is on and
 * cannot be read. Learning then stops: a change written to the file alone would be undone by the next
 * run, which copies the store over the file (D149).
 */
async function openPreferencesStore(
  ctx: CommandContext,
  connect: Connect,
): Promise<{ sql: SqlClient; stored: ConfigDocument | undefined } | "unreachable" | null> {
  const url = configStoreUrl(ctx.env);
  if (url === null) return null;
  try {
    const sql = await connect(url);
    const documents = await readConfigDocuments(sql);
    return { sql, stored: documents.find((d) => d.path === CONFIG_FILES.preferences) };
  } catch (error) {
    ctx.log.error(
      `Config store unreachable, so nothing was learned (a file-only change would be undone by the next run). Run learn again: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "unreachable";
  }
}

const preferencesText = (data: unknown): string => `${JSON.stringify(data, null, 2)}\n`;

/**
 * Write the learned preferences to the store on the version read. An edit made in the app since the
 * read is kept: the patch is applied once more on top of it, once. False when it could not be written.
 */
async function writeStored(
  store: { sql: SqlClient; stored: ConfigDocument | undefined },
  current: Preferences,
  next: Preferences,
  reapply: (current: Preferences) => Preferences,
  ctx: CommandContext,
): Promise<boolean> {
  try {
    const path = CONFIG_FILES.preferences;
    if (
      await writeConfigDocument(
        store.sql,
        path,
        preferencesText(next),
        store.stored?.version ?? null,
      )
    )
      return true;
    const again = (await readConfigDocuments(store.sql)).find((d) => d.path === path);
    // A row gone meanwhile is written afresh from what was read, never from `next` (that would move twice).
    const merged = reapply(again ? Preferences.parse(JSON.parse(again.content)) : current);
    return await writeConfigDocument(
      store.sql,
      path,
      preferencesText(merged),
      again?.version ?? null,
    );
  } catch (error) {
    ctx.log.warn(
      `Config store write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

const USAGE = `Usage:
  singularity learn --schema                 Print the JSON Schema of a preferences patch
  singularity learn --apply <patch.json>     Apply a patch (keywords, authors, disliked patterns)
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
  writeFileSync(tmp, preferencesText(data), "utf8");
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
async function commitRefusal(
  root: string,
  push: boolean,
  storeOn: boolean,
): Promise<string | null> {
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
  // A learn whose push failed left its commit here: a rerun would find nothing to commit and say so
  // as if all were well, while the commit never reached the remote (nor, with the store on, the
  // store). Push, and only with the store on run learn again: the file already holds the change.
  const ahead = await isAheadOfRemote(root).then(
    (value) => (value ? "yes" : "no"),
    () => "unknown",
  );
  if (ahead === "unknown")
    return "Cannot tell whether the branch has unpushed commits. Check git status first.";
  if (ahead === "yes") {
    return storeOn
      ? "The branch has commits its remote does not have. Push them (git push), then run learn again so the config store gets the change."
      : "The branch has commits its remote does not have. Push them (git push); a learn commit among them is already made, so do not run it again.";
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

/** `singularity learn`; the store is injected so tests drive it without a database. */
export function makeLearn(deps: { connectConfigStore?: Connect } = {}): CommandRun {
  return (argv, ctx) => learn(argv, ctx, deps.connectConfigStore ?? connectConfigStore);
}

export const run: CommandRun = makeLearn();

async function learn(argv: string[], ctx: CommandContext, connect: Connect): Promise<number> {
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
  // With the config store on (D149) the stored preferences are the current ones, not the file.
  const store = await openPreferencesStore(ctx, connect);
  if (store === "unreachable") return 1;
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

  const { next, changes } = applyPatch(current, patch, stockholmDate(ctx.now()));
  if (changes.length === 0) {
    ctx.log.info("No changes: the patch matched the current preferences.");
    return 0;
  }
  for (const line of changes) console.log(`+ ${line}`);

  if (argv.includes("--dry-run")) return 0;
  if (commit) {
    // Checked before anything is written, so a refusal leaves the tree exactly as it was.
    const refusal = await commitRefusal(ctx.root, !noPush, store !== null);
    if (refusal) {
      ctx.log.error(refusal);
      return 1;
    }
  }
  writeJson(prefsPath, next);
  if (commit) {
    const identity = await committerIdentity(ctx.root);
    const outcome = await commitAndPush({
      root: ctx.root,
      message: prefsCommitMessage(patch.input, changes),
      command: "learn",
      push: !noPush,
      ...(identity ? { identity } : {}),
    });
    const { ok, line } = describeCommit(outcome);
    if (!ok) {
      // The store is written only once the commit is in: a rerun after a failed push then starts
      // from the same stored preferences and applies the patch once, not twice.
      ctx.log.error(line);
      return 1;
    }
    ctx.log.info(line);
  }
  if (store !== null) {
    const reapply = (stored: Preferences) =>
      applyPatch(stored, patch, stockholmDate(ctx.now())).next;
    if (!(await writeStored(store, current, next, reapply, ctx))) {
      ctx.log.error(
        `${CONFIG_FILES.preferences} is updated but the config store is not, so the next run will use the stored preferences. Run learn again.`,
      );
      return 1;
    }
  }
  if (!commit) {
    ctx.log.info(
      `Updated ${CONFIG_FILES.preferences}. Review the diff, then commit as "chore(prefs): ...".`,
    );
  }
  return 0;
}
