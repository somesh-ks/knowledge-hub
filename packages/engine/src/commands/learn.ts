import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILES, Preferences, stockholmDate } from "@dispatch/core";
import { z } from "zod";
import type { CommandRun } from "../context.js";
import { applyPatch, PreferencesPatch } from "../learn/patch.js";

const USAGE = `Usage:
  dispatch learn --schema                 Print the JSON Schema of a preferences patch
  dispatch learn --apply <patch.json>     Apply a patch within the bounds (0.05 per weight, 0.15 total)
    [--dry-run]                           Show the diff without writing`;

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
  const prefsPath = join(ctx.root, CONFIG_FILES.preferences);
  const current = Preferences.parse(JSON.parse(readFileSync(prefsPath, "utf8")));
  const patch = PreferencesPatch.parse(JSON.parse(readFileSync(patchPath, "utf8")));

  const { next, changes, clamped } = applyPatch(current, patch, stockholmDate(ctx.now()));
  if (changes.length === 0) {
    ctx.log.info("No changes: the patch matched the current preferences.");
    return 0;
  }
  for (const line of changes) console.log(`+ ${line}`);
  for (const line of clamped) ctx.log.warn(`Clamped: ${line}`);

  if (argv.includes("--dry-run")) return 0;
  writeJson(prefsPath, next);
  ctx.log.info(
    `Updated ${CONFIG_FILES.preferences}. Review the diff, then commit as "chore(prefs): ...".`,
  );
  return 0;
};
