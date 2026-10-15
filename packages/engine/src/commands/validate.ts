import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parseDigestFile, VOICE_LIMITS } from "@dispatch/core";
import { type CommandRun, secretsFromEnv } from "../context.js";
import { loadPool, loadSources } from "../curate/inputs.js";
import { emit } from "../curate/output.js";
import { fromRoot } from "../curate/runDir.js";
import { describeError } from "../llm/errors.js";
import { validateDigest } from "../validate/validateDigest.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";

export const VALIDATE_USAGE = "Usage: dispatch validate <digest-path> [--pool <path>]";

/**
 * `dispatch validate <digest-path>`: schema, item limits, voice lint, section and Top picks
 * rules on any digest file. With `--pool` it also checks that every URL came from the pool.
 * Exit codes: 0 valid (warnings allowed), 1 errors found or the file could not be read, 2 usage.
 */
export const run: CommandRun = async (argv, ctx) => {
  let digestPath: string;
  let poolFlag: string | undefined;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { pool: { type: "string" } },
    });
    if (positionals.length !== 1) throw new Error("Expected exactly one digest path.");
    digestPath = positionals[0] as string;
    poolFlag = values.pool;
  } catch (error) {
    ctx.log.error(
      `${error instanceof Error ? error.message : "Invalid arguments."} ${VALIDATE_USAGE}`,
    );
    return 2;
  }

  try {
    const path = fromRoot(ctx.root, digestPath);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      ctx.log.error(`Could not read the digest file: ${digestPath}`);
      return 1;
    }
    const digest = (() => {
      try {
        return parseDigestFile(text);
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n")[0] : "invalid digest";
        throw new Error(`${digestPath} is not a valid digest file (${detail}).`);
      }
    })();

    const linter = createLinter(await loadVoice(ctx.root));
    const sources = await loadSources(ctx.root);
    const pool = poolFlag ? (await loadPool(fromRoot(ctx.root, poolFlag))).items : undefined;
    // A published briefing's length came from settings this file does not record, so its count
    // is checked against the digest's hard cap only.
    const report = validateDigest(digest, {
      pool,
      sources,
      linter,
      cap: VOICE_LIMITS.items.hardMax,
    });

    const lines = report.ok
      ? [`${digest.id} is valid${report.warnings > 0 ? ` (${report.warnings} warnings)` : ""}.`]
      : [`${digest.id} has ${report.errors} errors.`];
    for (const issue of report.issues) {
      lines.push(`${issue.severity}: ${issue.itemId ? `${issue.itemId}: ` : ""}${issue.message}`);
    }
    emit(ctx, lines, { digest: digest.id, ...report });
    return report.ok ? 0 : 1;
  } catch (error) {
    ctx.log.error(describeError(error, secretsFromEnv(ctx.env)));
    return 1;
  }
};
