import type { Item } from "@dispatch/core";
import { requireKey } from "@dispatch/core";
import { type CommandContext, secretsFromEnv } from "../context.js";
import type { ExtractedText } from "../extract/extractText.js";
import { extractFullText } from "../extract/extractText.js";
import { createFirecrawlScrape } from "../extract/firecrawlScrape.js";
import { FallbackJudge } from "../judge/fallbackJudge.js";
import { JevJudge } from "../judge/jev.js";
import { createJevClient } from "../judge/jevClient.js";
import { NebiusJudge } from "../judge/nebiusJudge.js";
import { TopicJudge } from "../judge/topicJudge.js";
import type { Judge, JudgeFailure } from "../judge/types.js";
import { withModelFailover } from "../llm/failoverClient.js";
import { createNebiusLlm } from "../llm/nebiusClient.js";
import { createOpenAiChatApi } from "../llm/openAiChatApi.js";
import { TokenBudget } from "../llm/tokenBudget.js";
import { type Grounder, JevGrounder } from "../validate/grounding.js";
import type { VoiceConfig } from "../voice/voice.js";
import { NebiusWriter } from "../write/nebiusWriter.js";
import type { Writer } from "../write/types.js";

/** Builds the runtime from the environment. Tests inject a factory that returns fakes. */
export type ApiRuntimeFactory = (ctx: CommandContext, voice: VoiceConfig) => ApiRuntime;

/** Everything the API curator calls out to, wired from the environment. */
export interface ApiRuntime {
  judge: Judge;
  writer: Writer;
  grounder: Grounder | null;
  /**
   * Judges items against custom topics. Null without a Jev key: the Nebius fallback judge only
   * knows the built-in categories, so custom topics wait for a run that has the key.
   */
  topicJudge?: TopicJudge | null;
  extract: (item: Item) => Promise<ExtractedText | null>;
  /** Judge failures collected during the run, for the report. */
  judgeFailures: JudgeFailure[];
  /** Spend so far, for the report. */
  usage: () => { nebiusTokens: number; nebiusTokenLimit: number };
}

/**
 * Build the real clients from the typed environment. Missing keys fail with a message that names
 * the variable and never a value.
 *
 *   judge     Jev when TYPESAFE_API_KEY is set (the Nebius judge answers items Jev cannot);
 *             otherwise the Nebius fallback judge alone, with a warning.
 *   writer    DISPATCH_MODEL on Nebius, failing over to DISPATCH_FALLBACK_MODEL on model-not-found.
 *   grounder  Jev, or none (the digest is then unverified).
 *   scraper   Firecrawl when FIRECRAWL_API_KEY is set.
 */
export function createApiRuntime(ctx: CommandContext, voice: VoiceConfig): ApiRuntime {
  const { env, log } = ctx;
  requireKey(env, "NEBIUS_API_KEY");
  const model = requireKey(env, "DISPATCH_MODEL");
  const secrets = secretsFromEnv(env);
  const judgeFailures: JudgeFailure[] = [];
  const onFailure = (failure: JudgeFailure): void => {
    judgeFailures.push(failure);
  };

  const budget = new TokenBudget(env.MAX_TOKENS_PER_RUN);
  const api = createOpenAiChatApi(env);
  const primary = createNebiusLlm({ api, model, budget, log });
  const fallback = env.DISPATCH_FALLBACK_MODEL
    ? createNebiusLlm({ api, model: env.DISPATCH_FALLBACK_MODEL, budget, log })
    : null;
  const llm = withModelFailover(primary, fallback, log);

  const nebiusJudge = new NebiusJudge({ llm, log, onFailure, secrets });
  let judge: Judge = nebiusJudge;
  let grounder: Grounder | null = null;
  let topicJudge: TopicJudge | null = null;
  if (env.TYPESAFE_API_KEY) {
    const jevClient = createJevClient(env);
    topicJudge = new TopicJudge({ client: jevClient, log, onFailure, secrets });
    judge = new FallbackJudge(
      new JevJudge({ client: jevClient, log, onFailure, secrets }),
      nebiusJudge,
      log,
    );
    grounder = new JevGrounder({ client: jevClient, log, secrets });
  } else {
    log.warn(
      "TYPESAFE_API_KEY is not set: judging with the Nebius fallback judge (lower trust) and skipping the grounding check; the digest will be unverified",
    );
  }

  const scrape = env.FIRECRAWL_API_KEY
    ? createFirecrawlScrape({ apiKey: env.FIRECRAWL_API_KEY })
    : null;
  return {
    judge,
    writer: new NebiusWriter({ llm, voice, log, secrets }),
    grounder,
    topicJudge,
    extract: (item) => extractFullText(item, { scrape, log }),
    judgeFailures,
    usage: () => ({ nebiusTokens: budget.used, nebiusTokenLimit: budget.limit }),
  };
}
