import { join } from "node:path";
import type { Item } from "@singularity/core";
import { loadModelRouting } from "@singularity/core";
import {
  type Alexandria,
  createAlexandria,
  loadAlexandriaConfig,
} from "../alexandria/alexandria.js";
import { type CommandContext, secretsFromEnv } from "../context.js";
import type { ExtractedText } from "../extract/extractText.js";
import { extractFullText } from "../extract/extractText.js";
import { createFirecrawlScrape } from "../extract/firecrawlScrape.js";
import { createVideoText, withVideoText } from "../extract/youtubeText.js";
import type { FirecrawlGuard } from "../fetch/firecrawlBudget.js";
import { breakJev } from "../judge/breaker.js";
import { CombinedJudge } from "../judge/combinedJudge.js";
import { FallbackJudge } from "../judge/fallbackJudge.js";
import { GeneralJudge } from "../judge/generalJudge.js";
import { JevJudge } from "../judge/jev.js";
import { createJevClient } from "../judge/jevClient.js";
import { LlmJudge } from "../judge/llmJudge.js";
import { TopicJudge } from "../judge/topicJudge.js";
import type { Judge, JudgeFailure } from "../judge/types.js";
import { withModelFallback } from "../llm/jevFallback.js";
import { resolveFamilies } from "../llm/modelResolver.js";
import { createModelRouter, type ModelRouterOptions } from "../llm/modelRouter.js";
import { meterJev, type RequestMeter } from "../llm/requestMeter.js";
import { TokenBudget } from "../llm/tokenBudget.js";
import { TasteFitter } from "../profile/tasteFit.js";
import { type Grounder, JevGrounder } from "../validate/grounding.js";
import { GROUNDING_SENTENCE_CONCURRENCY } from "../validate/groundingRepair.js";
import type { VoiceConfig } from "../voice/voice.js";
import { LlmWriter } from "../write/llmWriter.js";
import type { Writer } from "../write/types.js";

/** Builds the runtime from the environment. Tests inject a factory that returns fakes. */
export type ApiRuntimeFactory = (ctx: CommandContext, voice: VoiceConfig) => ApiRuntime;

/** Everything the API curator calls out to, wired from the environment. */
export interface ApiRuntime {
  judge: Judge;
  writer: Writer;
  grounder: Grounder | null;
  /**
   * Judges items against custom topics. Null without a Jev key: the fallback judge only
   * knows the built-in categories, so custom topics wait for a run that has the key.
   */
  topicJudge?: TopicJudge | null;
  /**
   * Asks the main questions and the topic fits in one Jev request for an item that needs both.
   * Null without a Jev key. Tests that inject fakes leave it out and get two separate requests.
   */
  combinedJudge?: CombinedJudge | null;
  /**
   * Judges the stories of the general news feeds: the topic's fit and the trust flags in one Jev
   * request each (D66). Null without a Jev key; the stories are then skipped.
   */
  generalJudge?: GeneralJudge | null;
  /**
   * Judges the scoring sample (D70): Jev alone, with no model fallback, so a Jev outage can never
   * spend the writer's token budget on items judged for scores. Null without a Jev key; the sample
   * then waits for a run that has one.
   */
  sampleJudge?: Judge | null;
  /** Jev's check of candidates against the owner's taste (profile/tasteFit.ts). Null without a Jev key. */
  tasteFitter?: TasteFitter | null;
  extract: (item: Item) => Promise<ExtractedText | null>;
  /** Sourced facts from Firecrawl Alexandria for a thin finalist; absent without a Firecrawl key. */
  enrich?: ((item: Item) => Promise<string | null>) | undefined;
  /** Judge failures collected during the run, for the report. */
  judgeFailures: JudgeFailure[];
  /** Spend so far, for the report. */
  usage: () => { tokens: number; tokenLimit: number };
}

/**
 * Build the real clients from the typed environment. Missing keys fail with a message that names
 * the variable and never a value.
 *
 * Every model step follows config/models.json through the model router (llm/modelRouter.ts):
 *   judge     Jev when TYPESAFE_API_KEY is set, the routed Haiku or Flash-Lite judge for items Jev
 *             cannot answer; otherwise the routed judge alone, with a warning.
 *   writer    the story_writer chain (Sonnet, then Gemini Flash); rewrites use story_rewrite.
 *   grounder  Jev, then Gemini Flash or Haiku; none without a Jev key (the digest is unverified).
 *   scraper   Firecrawl when FIRECRAWL_API_KEY is set.
 */
export function createApiRuntime(
  ctx: CommandContext,
  voice: VoiceConfig,
  spend?: { meter: RequestMeter; guard: FirecrawlGuard },
  openBatches?: ModelRouterOptions["openBatches"],
): ApiRuntime {
  const { env, log } = ctx;
  const secrets = secretsFromEnv(env);
  const judgeFailures: JudgeFailure[] = [];
  const onFailure = (failure: JudgeFailure): void => {
    judgeFailures.push(failure);
  };

  if (!env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
    throw new Error(
      "Set ANTHROPIC_API_KEY or GEMINI_API_KEY: the writer and the fallback judge need a model key.",
    );
  }
  const routing = loadModelRouting(ctx.root);
  const budget = new TokenBudget(env.MAX_TOKENS_PER_RUN);
  const router = createModelRouter({
    routing,
    resolve: () => resolveFamilies({ routing, env, log }),
    env,
    budget,
    log,
    onRequest: spend ? (provider) => spend.meter.add(provider) : undefined,
    onUsage: spend
      ? (usage) => {
          // Batch tokens are priced at the Message Batches rate (half), so they are their own unit.
          const prefix = usage.batch ? "batch_" : "";
          spend.meter.addUnits(
            usage.provider,
            usage.model,
            `${prefix}input_tokens`,
            usage.inputTokens,
          );
          spend.meter.addUnits(
            usage.provider,
            usage.model,
            `${prefix}output_tokens`,
            usage.outputTokens,
          );
        }
      : undefined,
    onFallback: spend ? () => spend.meter.add("model_fallback") : undefined,
    ...(openBatches ? { openBatches } : {}),
  });

  const llmJudge = new LlmJudge({ llm: router.llmFor("judge"), log, onFailure, secrets });
  let judge: Judge = llmJudge;
  let grounder: Grounder | null = null;
  let topicJudge: TopicJudge | null = null;
  let combinedJudge: CombinedJudge | null = null;
  let generalJudge: GeneralJudge | null = null;
  let sampleJudge: Judge | null = null;
  let tasteFitter: TasteFitter | null = null;
  if (env.TYPESAFE_API_KEY) {
    const rawJev = createJevClient(env);
    const meteredJev = spend ? meterJev(rawJev, spend.meter) : rawJev;
    const jevClient = breakJev(meteredJev, { log });
    combinedJudge = new CombinedJudge({
      client: jevClient,
      log,
      onFailure,
      secrets,
      fallback: llmJudge,
    });
    topicJudge = new TopicJudge({ client: jevClient, log, onFailure, secrets });
    generalJudge = new GeneralJudge({ client: jevClient, log, onFailure, secrets });
    const jevJudge = new JevJudge({ client: jevClient, log, onFailure, secrets });
    judge = new FallbackJudge(jevJudge, llmJudge, log);
    sampleJudge = jevJudge;
    grounder = new JevGrounder({
      client: withModelFallback(jevClient, router, "grounding", log),
      concurrency: GROUNDING_SENTENCE_CONCURRENCY,
      log,
      secrets,
    });
    tasteFitter = new TasteFitter({
      client: withModelFallback(jevClient, router, "taste_fit", log),
      log,
      secrets,
    });
  } else {
    log.warn(
      "TYPESAFE_API_KEY is not set: judging with the routed fallback judge (lower trust) and skipping the grounding check; the digest will be unverified",
    );
  }

  const scrape = env.FIRECRAWL_API_KEY
    ? createFirecrawlScrape({ apiKey: env.FIRECRAWL_API_KEY, guard: spend?.guard })
    : null;
  let alexandria: Promise<Alexandria> | null = null;
  const enrich = env.FIRECRAWL_API_KEY
    ? async (item: Item): Promise<string | null> => {
        const apiKey = env.FIRECRAWL_API_KEY as string;
        alexandria ??= loadAlexandriaConfig(ctx.root).then((config) =>
          createAlexandria({
            apiKey,
            config,
            guard: spend?.guard,
            onCredits: (credits, estimated) =>
              spend?.meter.addUnits(
                "firecrawl",
                "alexandria",
                estimated ? "credits_estimated" : "credits",
                credits,
              ),
          }),
        );
        return (await alexandria).factsFor(item);
      }
    : undefined;
  return {
    judge,
    enrich,
    writer: new LlmWriter({
      llm: router.llmFor("story_writer"),
      batch: router.batchFor("story_writer"),
      voice,
      log,
      secrets,
    }),
    grounder,
    topicJudge,
    combinedJudge,
    generalJudge,
    sampleJudge,
    tasteFitter,
    extract: withVideoText(
      (item) => extractFullText(item, { scrape, log }),
      createVideoText({
        apiKey: env.GEMINI_API_KEY,
        models: () => router.modelsFor("transcription"),
        cachePath: join(ctx.root, "state", "video-text.json"),
        log,
        firecrawl: env.FIRECRAWL_API_KEY
          ? {
              apiKey: env.FIRECRAWL_API_KEY,
              guard: spend?.guard,
              onCredits: (credits, estimated) =>
                spend?.meter.addUnits(
                  "firecrawl",
                  "alexandria",
                  estimated ? "credits_estimated" : "credits",
                  credits,
                ),
            }
          : undefined,
        onUsage: spend
          ? (usage) => {
              spend.meter.add("gemini");
              spend.meter.addUnits("gemini", usage.model, "input_tokens", usage.inputTokens);
              spend.meter.addUnits("gemini", usage.model, "output_tokens", usage.outputTokens);
            }
          : undefined,
      }),
    ),
    judgeFailures,
    usage: () => ({ tokens: budget.used, tokenLimit: budget.limit }),
  };
}
