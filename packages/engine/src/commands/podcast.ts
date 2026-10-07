import { parseArgs } from "node:util";
import { requireKey } from "@dispatch/core";
import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { emit } from "../curate/output.js";
import { type CommitOutcome, commitAndPush } from "../git/commit.js";
import { describeError } from "../llm/errors.js";
import { withModelFailover } from "../llm/failoverClient.js";
import { createNebiusLlm } from "../llm/nebiusClient.js";
import { createOpenAiChatApi } from "../llm/openAiChatApi.js";
import { TokenBudget } from "../llm/tokenBudget.js";
import { generateEpisode } from "../podcast/generate.js";
import { NebiusScriptWriter } from "../podcast/nebiusScriptWriter.js";
import { parseRequest } from "../podcast/plan.js";
import { InvalidRequestError, PodcastError, type ScriptWriter } from "../podcast/types.js";

export const PODCAST_USAGE = "Usage: dispatch podcast --request '<json>' [--now <iso>] [--no-push]";

export interface PodcastDeps {
  /** The script writer. Defaults to a Nebius model from DISPATCH_MODEL. */
  makeWriter?: (ctx: CommandContext) => ScriptWriter;
}

/** The Nebius writer, with the same model and fallback the digest writer uses. */
function nebiusWriter(ctx: CommandContext): ScriptWriter {
  const { env, log } = ctx;
  requireKey(env, "NEBIUS_API_KEY");
  const model = requireKey(env, "DISPATCH_MODEL");
  const budget = new TokenBudget(env.MAX_TOKENS_PER_RUN);
  const api = createOpenAiChatApi(env);
  const primary = createNebiusLlm({ api, model, budget, log });
  const fallback = env.DISPATCH_FALLBACK_MODEL
    ? createNebiusLlm({ api, model: env.DISPATCH_FALLBACK_MODEL, budget, log })
    : null;
  return new NebiusScriptWriter({
    llm: withModelFailover(primary, fallback, log),
    log,
    secrets: secretsFromEnv(env),
  });
}

function commitFailure(outcome: CommitOutcome): string | null {
  switch (outcome.status) {
    case "nothing_to_commit":
      return "Nothing to commit: the episode file was not picked up by git";
    case "refused":
      return `Commit refused (${outcome.reason}): ${outcome.offending.join(", ")}`;
    case "push_failed":
      return `Committed ${outcome.sha.slice(0, 7)} but the push failed (${outcome.reason}): ${outcome.detail}`;
    default:
      return null;
  }
}

/**
 * `dispatch podcast`: write one episode of Singularity from published digests and commit it under
 * Podcasts/ through the write guard. Exit codes: 0 written and committed, 1 failure, 2 usage or
 * invalid request. The last line printed (the whole output in --json mode aside) is the episode id.
 */
export function makePodcastCommand(deps: PodcastDeps = {}): CommandRun {
  return async (argv, ctx) => {
    let values: { request?: string; now?: string; "no-push"?: boolean };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          request: { type: "string" },
          now: { type: "string" },
          "no-push": { type: "boolean" },
        },
      }).values;
    } catch (error) {
      ctx.log.error(
        `${error instanceof Error ? error.message : "Invalid arguments."} ${PODCAST_USAGE}`,
      );
      return 2;
    }
    if (values.request === undefined) {
      ctx.log.error(`--request is required. ${PODCAST_USAGE}`);
      return 2;
    }

    let now = ctx.now();
    if (values.now !== undefined) {
      now = new Date(values.now);
      if (Number.isNaN(now.getTime())) {
        ctx.log.error(`--now is not a date: ${values.now}. ${PODCAST_USAGE}`);
        return 2;
      }
    }

    try {
      const request = parseRequest(values.request);
      const result = await generateEpisode({
        root: ctx.root,
        request,
        now,
        makeWriter: () => (deps.makeWriter ?? nebiusWriter)(ctx),
        log: ctx.log,
      });
      const { episode, relPath } = result;
      const outcome = await commitAndPush({
        root: ctx.root,
        message: `feat(podcast): add ${episode.id}`,
        command: "podcast",
        push: values["no-push"] !== true,
      });
      const failure = commitFailure(outcome);
      if (failure !== null) {
        ctx.log.error(`${failure}. The episode file stays at ${relPath}.`);
        return 1;
      }
      emit(
        ctx,
        [
          `Selected ${episode.sources.length} of ${result.matched} matching stories from ${result.digests} digests.`,
          `Wrote ${relPath}: ${episode.turns.length} turns, ${episode.char_count} characters, about ${episode.listen_minutes} min.`,
          episode.id,
        ],
        {
          outcome: outcome.status,
          episode_id: episode.id,
          path: relPath,
          stories: episode.sources.length,
          turns: episode.turns.length,
          char_count: episode.char_count,
          listen_minutes: episode.listen_minutes,
        },
      );
      return 0;
    } catch (error) {
      if (error instanceof PodcastError) {
        // The request, the stories or the script is at fault; the message is already for the listener.
        ctx.log.error(error.message);
        return error instanceof InvalidRequestError ? 2 : 1;
      }
      ctx.log.error(`podcast failed: ${describeError(error, secretsFromEnv(ctx.env))}`);
      return 1;
    }
  };
}

export const run: CommandRun = makePodcastCommand();
