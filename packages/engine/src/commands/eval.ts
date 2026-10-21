import type { CommandRun } from "../context.js";

const NOTICE = `dispatch eval calls TypeSafe Jev and the routed Claude and Gemini models with your keys.
It costs a few cents per run and is meant for tuning thresholds.
It never runs in CI. Pass --yes to proceed.`;

/** The eval runner's own entry point, loaded on demand: it pulls in every model client. */
export type EvalMain = (argv: string[]) => Promise<number>;

async function loadEvalMain(): Promise<EvalMain> {
  return (await import("../../eval/run.js")).main;
}

/**
 * `dispatch eval`: the golden-set evaluation in packages/engine/eval/run.ts, as a command. It
 * spends money, so it needs an explicit --yes; every other flag goes to the runner unchanged.
 */
export function makeEvalCommand(loadMain: () => Promise<EvalMain> = loadEvalMain): CommandRun {
  return async (argv, ctx) => {
    if (!argv.includes("--yes")) {
      process.stderr.write(`${NOTICE}\n`);
      return 2;
    }
    const rest = argv.filter((arg) => arg !== "--yes");
    ctx.log.warn("dispatch eval is using your API keys and spending money");
    const args = ctx.json && !rest.includes("--json") ? [...rest, "--json"] : rest;
    return (await loadMain())(args);
  };
}

export const run: CommandRun = makeEvalCommand();
