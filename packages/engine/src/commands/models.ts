import { parseArgs } from "node:util";
import { loadModelRouting } from "@dispatch/core";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";
import { resolveFamilies } from "../llm/modelResolver.js";

const USAGE = "Usage: dispatch models [--json]";

/**
 * `dispatch models`: the routing in config/models.json and the model each family resolves to now
 * (the newest generally available id the provider lists, or the pinned one). Calls the providers'
 * model lists when their keys are set; never prints a key.
 */
export function makeModelsCommand(fetchImpl: typeof fetch = fetch): CommandRun {
  return async (argv, ctx) => {
    try {
      parseArgs({ args: argv, allowPositionals: false, strict: true, options: {} });
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    try {
      const routing = loadModelRouting(ctx.root);
      const resolved = await resolveFamilies({
        routing,
        env: ctx.env,
        log: ctx.log,
        fetch: fetchImpl,
      });
      const steps = Object.entries(routing.steps).map(([step, value]) => ({
        step,
        chain: value.chain.map((entry) => ({
          family: entry.family,
          model: resolved[entry.family]?.id ?? null,
          effort: entry.effort ?? null,
        })),
      }));
      if (ctx.json) {
        process.stdout.write(`${JSON.stringify({ families: resolved, steps })}\n`);
      } else {
        const lines = Object.values(resolved).map(
          (model) => `${model.family.padEnd(18)} ${model.id}  (${model.source})`,
        );
        lines.push("");
        for (const { step, chain } of steps) {
          lines.push(
            `${step.padEnd(16)} ${chain.map((entry) => entry.model ?? entry.family).join(" -> ")}`,
          );
        }
        process.stdout.write(`${lines.join("\n")}\n`);
      }
      return 0;
    } catch (error) {
      ctx.log.error(
        redact(
          error instanceof Error
            ? (error.message.split("\n")[0] ?? "request failed")
            : "request failed",
          secretsFromEnv(ctx.env),
        ),
      );
      return 1;
    }
  };
}

export const run: CommandRun = makeModelsCommand();
