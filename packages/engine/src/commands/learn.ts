import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILES, Preferences, stockholmDate } from "@singularity/core";
import { z } from "zod";
import type { CommandContext, CommandRun } from "../context.js";
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
    [--dry-run]                           Show the diff without writing`;

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
  if (argv.includes("--commit") || argv.includes("--no-push")) {
    ctx.log.info("The preferences are not in git (D296): --commit and --no-push do nothing.");
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
  writeJson(prefsPath, next);
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
  ctx.log.info(
    store === null
      ? `Updated ${CONFIG_FILES.preferences}.`
      : `Updated ${CONFIG_FILES.preferences} and the config store.`,
  );
  return 0;
}
