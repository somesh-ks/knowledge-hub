import { pickCover } from "@dispatch/cover";
import { type CommandContext, secretsFromEnv } from "../context.js";
import { type ApiRuntime, createApiRuntime } from "../curate/apiRuntime.js";
import { createGitRunner } from "../git/runGit.js";
import { createHttpClient } from "../http.js";
import { loadVoice } from "../voice/voice.js";
import type { RunDeps } from "./types.js";

/**
 * The real dependencies, from the command context: HTTP for the fetchers, the model clients
 * (built on first use, so the gate, fetch and commit stages need no key), Firecrawl scraping
 * through the runtime's extractor when FIRECRAWL_API_KEY is set, the cover package's picker and
 * git in the repository root. The runtime is shared by the stages of one invocation, so the
 * token budget covers a whole combined run.
 */
export function buildDeps(ctx: CommandContext): RunDeps {
  let runtime: Promise<ApiRuntime> | undefined;
  return {
    root: ctx.root,
    now: ctx.now,
    log: ctx.log,
    secrets: secretsFromEnv(ctx.env),
    fetch: {
      http: createHttpClient({ retries: 2 }),
      exaKey: ctx.env.EXA_API_KEY,
      firecrawlKey: ctx.env.FIRECRAWL_API_KEY,
    },
    runtime: () => {
      runtime ??= loadVoice(ctx.root).then((voice) => createApiRuntime(ctx, voice));
      return runtime;
    },
    pickCover,
    git: createGitRunner(ctx.root),
  };
}
