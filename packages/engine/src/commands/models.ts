import { parseArgs } from "node:util";
import { isTextModel, listModels, type ModelRow, requireKey } from "@dispatch/core";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";

const USAGE = "Usage: dispatch models [--all] [--limit <n>] [--json]";
const DEFAULT_LIMIT = 60;
const TIMEOUT_MS = 20_000;

// The list schema and the text-model filter live in core so the site shares them.
export { isTextModel, listModels, type ModelRow };

function joinUrl(base: string, path: string): string {
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

/**
 * `dispatch models`: the Nebius models your key can call, to choose DISPATCH_MODEL for the
 * bake-off. Uses GET /v1/models?verbose=true for context lengths.
 */
export function makeModelsCommand(fetchImpl: typeof fetch = fetch): CommandRun {
  return async (argv, ctx) => {
    let values: { all?: boolean | undefined; limit?: string | undefined };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: { all: { type: "boolean" }, limit: { type: "string" } },
      }).values;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      ctx.log.error(`--limit needs a whole number of at least 1. ${USAGE}`);
      return 2;
    }

    const secrets = secretsFromEnv(ctx.env);
    try {
      const key = requireKey(ctx.env, "NEBIUS_API_KEY");
      const response = await fetchImpl(joinUrl(ctx.env.NEBIUS_BASE_URL, "models?verbose=true"), {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const hint =
          response.status === 401 || response.status === 403
            ? " The key was rejected; check NEBIUS_API_KEY."
            : "";
        ctx.log.error(`Nebius answered HTTP ${response.status} for /models.${hint}`);
        return 1;
      }
      const all = listModels(await response.json(), values.all === true);
      const shown = all.slice(0, limit);
      if (ctx.json) {
        process.stdout.write(
          `${JSON.stringify({ total: all.length, shown: shown.length, truncated: all.length > shown.length, models: shown })}\n`,
        );
      } else {
        const lines = shown.map(
          (model) =>
            `${model.id}${model.context_length === null ? "" : `  (${model.context_length} tokens)`}`,
        );
        if (all.length > shown.length) {
          lines.push(`... ${all.length - shown.length} more; raise --limit to see them`);
        }
        lines.push(
          "",
          "Set the chosen id as DISPATCH_MODEL (and a second as DISPATCH_FALLBACK_MODEL) in .env.",
        );
        process.stdout.write(`${lines.join("\n")}\n`);
      }
      return 0;
    } catch (error) {
      ctx.log.error(
        redact(
          error instanceof Error
            ? (error.message.split("\n")[0] ?? "request failed")
            : "request failed",
          secrets,
        ),
      );
      return 1;
    }
  };
}

export const run: CommandRun = makeModelsCommand();
