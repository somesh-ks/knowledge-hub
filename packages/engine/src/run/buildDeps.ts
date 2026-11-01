import { pickCover } from "@singularity/cover";
import { type CommandContext, secretsFromEnv } from "../context.js";
import { type ApiRuntime, createApiRuntime } from "../curate/apiRuntime.js";
import { createGitRunner } from "../git/runGit.js";
import { createHttpClient } from "../http.js";
import { trackOpenBatches } from "../llm/openBatches.js";
import { meterExa } from "../llm/requestMeter.js";
import { configStoreUrl, connectConfigStore } from "../store/configPaths.js";
import { recordExperimentHits } from "../store/experimentHits.js";
import { loadVoice } from "../voice/voice.js";
import { readPlan } from "./plan.js";
import { SpendTracker } from "./spend.js";
import type { RunDeps } from "./types.js";

/** How long a save that only adds to a page may hold the run (the driver sets no timeout). */
const SAVE_SECONDS = 10;

/** Runs `task`, and rejects when it has not finished in `seconds`; the task itself is left to end. */
async function withinSeconds<T>(seconds: number, task: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${seconds} s`)), seconds * 1000);
  });
  try {
    return await Promise.race([task(), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The real dependencies, from the command context: HTTP for the fetchers, the model clients
 * (built on first use, so the gate, fetch and commit stages need no key), Firecrawl scraping
 * through the runtime's extractor when FIRECRAWL_API_KEY is set, the cover package's picker and
 * git in the repository root. The runtime is shared by the stages of one invocation, so the
 * token budget covers a whole combined run.
 */
export function buildDeps(ctx: CommandContext): RunDeps {
  let runtime: Promise<ApiRuntime> | undefined;
  const spend = new SpendTracker();
  const storeUrl = configStoreUrl(ctx.env);
  return {
    root: ctx.root,
    now: ctx.now,
    log: ctx.log,
    secrets: secretsFromEnv(ctx.env),
    fetch: {
      http: meterExa(createHttpClient({ retries: 2 }), spend.meter),
      exaKey: ctx.env.EXA_API_KEY,
      firecrawlKey: ctx.env.FIRECRAWL_API_KEY,
      firecrawlGuard: spend.guard,
      sampleJudge: Boolean(ctx.env.TYPESAFE_API_KEY),
    },
    spend,
    runtime: () => {
      // The run's plan names its open-batch list, so a batch the write stage gives up on is settled later.
      runtime ??= Promise.all([loadVoice(ctx.root), readPlan(ctx.root).catch(() => null)]).then(
        ([voice, plan]) =>
          createApiRuntime(
            ctx,
            voice,
            spend,
            plan ? trackOpenBatches(ctx.root, plan.created_at) : undefined,
          ),
      );
      return runtime;
    },
    pickCover,
    git: createGitRunner(ctx.root),
    // With the config store on, the shadow counts go to Neon for the admin app; off, they stay in the log.
    recordExperimentHits: storeUrl
      ? async (hits) =>
          withinSeconds(SAVE_SECONDS, async () =>
            recordExperimentHits(await connectConfigStore(storeUrl), hits, ctx.now().getTime()),
          )
      : undefined,
  };
}
