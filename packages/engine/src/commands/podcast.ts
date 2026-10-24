import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadModelRouting, type PodcastRequest } from "@singularity/core";
import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { recordRunCosts } from "../cost/ledger.js";
import { emit } from "../curate/output.js";
import { type CommitOutcome, commitAndPush } from "../git/commit.js";
import type { HttpClient } from "../http.js";
import { describeError } from "../llm/errors.js";
import { resolveFamilies } from "../llm/modelResolver.js";
import { createModelRouter } from "../llm/modelRouter.js";
import { RequestMeter } from "../llm/requestMeter.js";
import { TokenBudget } from "../llm/tokenBudget.js";
import { episodeExists, parseCommand, readEpisode } from "../podcast/actions.js";
import { generateEpisode } from "../podcast/generate.js";
import { LlmScriptWriter } from "../podcast/llmScriptWriter.js";
import { planPodcast } from "../podcast/plan.js";
import { createStreamPublisher, pruneStreams, type StreamPublisher } from "../podcast/stream.js";
import {
  InvalidRequestError,
  PodcastError,
  type PodcastStory,
  type ScriptWriter,
} from "../podcast/types.js";
import { type BlobClient, createVercelBlobClient } from "../publish/blob.js";
import { publishEpisodeIndex } from "../publish/episodeIndex.js";
import { loadScheduleZone } from "../schedule/store.js";

export const PODCAST_USAGE =
  'Usage: singularity podcast --request \'<json: a new episode, {"action":"delete","id":...} or {"action":"regenerate","id":...,"feedback":...}>\' [--now <iso>] [--no-push] | [--dry-run [--save <path outside the repository>]]';

/** True when `path` is the repository root or anything under it. */
function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface PodcastDeps {
  /** The script writer. Defaults to the routed podcast models (config/models.json). */
  makeWriter?: (ctx: CommandContext) => ScriptWriter;
  /** Reads the news feeds of a general episode. Defaults to the engine's HTTP client. */
  http?: HttpClient;
  /** Where the live copy of the script goes. Defaults to Vercel Blob when its token is set. */
  blob?: BlobClient;
}

function blobClientFrom(token: string | undefined): BlobClient | null {
  return token ? createVercelBlobClient(token) : null;
}

/** The script writer: the podcast_script chain (Sonnet, then Gemini Flash), with its own opening and rewrite steps. */
function scriptWriter(ctx: CommandContext, meter: RequestMeter): ScriptWriter {
  const { env, log } = ctx;
  const routing = loadModelRouting(ctx.root);
  const router = createModelRouter({
    routing,
    resolve: () => resolveFamilies({ routing, env, log }),
    env,
    budget: new TokenBudget(env.MAX_TOKENS_PER_RUN),
    log,
    onRequest: (provider) => meter.add(provider),
    onUsage: (usage) => {
      meter.addUnits(usage.provider, usage.model, "input_tokens", usage.inputTokens);
      meter.addUnits(usage.provider, usage.model, "output_tokens", usage.outputTokens);
    },
    onFallback: () => meter.add("model_fallback"),
  });
  return new LlmScriptWriter({
    llm: router.llmFor("podcast_script"),
    log,
    secrets: secretsFromEnv(env),
  });
}

/**
 * After a pushed add, replace or removal, rewrite the episode index (D173) so the site lists the
 * change without waiting for a build. Best effort: the commit is the record, and the next episode
 * rewrites the whole index anyway. A local --no-push commit is never indexed: the site could not
 * open what the repository does not have.
 */
async function refreshEpisodeIndex(
  ctx: CommandContext,
  client: BlobClient | null,
  outcome: CommitOutcome,
): Promise<void> {
  if (!client || outcome.status !== "pushed") return;
  try {
    const { index, skipped } = await publishEpisodeIndex(client, ctx.root, ctx.now());
    ctx.log.info(`Episode index: ${index.episodes.length} episodes.`);
    if (skipped.length > 0)
      ctx.log.warn(`Episode index left out unreadable files: ${skipped.join(", ")}`);
  } catch (error) {
    ctx.log.warn(`Episode index not updated: ${describeError(error, secretsFromEnv(ctx.env))}`);
  }
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
 * `singularity podcast`: write one episode of Singularity from published digests and commit it under
 * Podcasts/ through the write guard. Exit codes: 0 written and committed, 1 failure, 2 usage or
 * invalid request. The last line printed (the whole output in --json mode aside) is the episode id.
 */
export function makePodcastCommand(deps: PodcastDeps = {}): CommandRun {
  return async (argv, ctx) => {
    let values: {
      request?: string;
      now?: string;
      "no-push"?: boolean;
      "dry-run"?: boolean;
      save?: string;
    };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          request: { type: "string" },
          now: { type: "string" },
          "no-push": { type: "boolean" },
          "dry-run": { type: "boolean" },
          save: { type: "string" },
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

    const dryRun = values["dry-run"] === true;
    if (dryRun && values["no-push"] === true) {
      ctx.log.error(`--dry-run and --no-push cannot be used together. ${PODCAST_USAGE}`);
      return 2;
    }
    if (values.save !== undefined) {
      if (!dryRun) {
        ctx.log.error(`--save needs --dry-run. ${PODCAST_USAGE}`);
        return 2;
      }
      if (isInside(ctx.root, values.save)) {
        ctx.log.error(`--save must be a path outside the repository: ${values.save}`);
        return 2;
      }
    }

    const meter = new RequestMeter();
    let now = ctx.now();
    if (values.now !== undefined) {
      now = new Date(values.now);
      if (Number.isNaN(now.getTime())) {
        ctx.log.error(`--now is not a date: ${values.now}. ${PODCAST_USAGE}`);
        return 2;
      }
    }

    // The live copy of the script, once one has been made (a holder, so the handlers below see it).
    const live: { stream: StreamPublisher | null } = { stream: null };
    try {
      const command = parseCommand(values.request);
      if (command.action === "delete") {
        const relPath = await episodeExists(ctx.root, command.id);
        if (dryRun) {
          process.stdout.write(
            `${JSON.stringify({ action: "delete", episode_id: command.id, would_remove: [relPath] })}
`,
          );
          return 0;
        }
        await rm(join(ctx.root, relPath));
        const outcome = await commitAndPush({
          root: ctx.root,
          message: `chore(podcast): remove ${command.id}`,
          command: "podcast",
          push: values["no-push"] !== true,
        });
        const failure = commitFailure(outcome);
        if (failure !== null) {
          ctx.log.error(
            `${failure}. The episode file was removed from the working tree: ${relPath}.`,
          );
          return 1;
        }
        await refreshEpisodeIndex(
          ctx,
          deps.blob ?? blobClientFrom(ctx.env.BLOB_READ_WRITE_TOKEN),
          outcome,
        );
        emit(ctx, [`Removed ${relPath}.`, command.id], {
          outcome: outcome.status,
          action: "delete",
          episode_id: command.id,
          path: relPath,
        });
        return 0;
      }
      // A regeneration reuses the stored request of the old episode and adds the listener feedback.
      const replaced =
        command.action === "regenerate" ? await readEpisode(ctx.root, command.id) : null;
      const stored = command.action === "create" ? command.request : replaced?.episode.request;
      if (!stored) throw new PodcastError("The request names no episode to replace.");
      // Topics chosen in the dialog apply to this regeneration only: the new episode stores them.
      const request =
        command.action === "regenerate" && command.topic_ids
          ? { ...stored, topic_ids: command.topic_ids }
          : stored;
      const feedback = command.action === "regenerate" ? command.feedback : undefined;
      // A new episode's script is copied to Blob as it is written, so it can be heard before the
      // commit is deployed. Best effort: without the token or the run id there is just no live copy.
      const blobClient = deps.blob ?? blobClientFrom(ctx.env.BLOB_READ_WRITE_TOKEN);
      // Set by Actions on every run; the context's parsed env does not carry it.
      const runId = process.env.GITHUB_RUN_ID;
      const makeStream =
        command.action === "create" && !dryRun && blobClient && runId
          ? (info: { id: string; request: PodcastRequest; stories: readonly PodcastStory[] }) => {
              void pruneStreams(blobClient, ctx.now(), ctx.log);
              live.stream = createStreamPublisher({
                client: blobClient,
                runId,
                episodeId: info.id,
                request: info.request,
                stories: info.stories,
                now: ctx.now,
                log: ctx.log,
              });
              return live.stream;
            }
          : undefined;
      const result = await generateEpisode({
        ...(makeStream ? { makeStream } : {}),
        root: ctx.root,
        request,
        now,
        makeWriter: () => (deps.makeWriter ? deps.makeWriter(ctx) : scriptWriter(ctx, meter)),
        ...(deps.http ? { http: deps.http } : {}),
        log: ctx.log,
        dryRun,
        ...(replaced ? { replaces: replaced.episode.id } : {}),
        ...(feedback ? { feedback } : {}),
      });
      const { episode, relPath } = result;
      if (dryRun) {
        if (values.save !== undefined && result.markdown !== undefined) {
          await mkdir(dirname(resolve(values.save)), { recursive: true });
          await writeFile(resolve(values.save), result.markdown, "utf8");
        }
        const budget = planPodcast(request).budget_chars;
        const chars = episode.char_count;
        process.stdout.write(
          `${JSON.stringify({
            audience: request.audience ?? "custom",
            format: request.format,
            length_minutes: request.length_minutes,
            topic_ids: request.topic_ids,
            budget_chars: budget,
            script_chars: chars,
            percent_of_budget: Math.round((chars / budget) * 100),
            listen_minutes: episode.listen_minutes,
            turns: episode.turns.length,
            speakers: [...new Set(episode.turns.map((turn) => turn.speaker))],
            stories: episode.sources.length,
            empty_topics: result.empty_topics,
            writer_calls: result.script.writer_calls,
            short_by_chars: result.script.short_by_chars,
            title: episode.title,
            ...(replaced
              ? { replaces: replaced.episode.id, would_remove: [replaced.relPath] }
              : {}),
            problems: result.script.last_problems,
          })}\n`,
        );
        return 0;
      }
      // The writer's tokens are the episode's cost: it belongs to whoever asked for it.
      await recordRunCosts(
        ctx.root,
        { requests: {}, units: meter.peekUnits() },
        { runId: episode.id, at: ctx.now().toISOString(), passKind: "on-demand" },
        await loadScheduleZone(ctx.root),
      );
      // The old file goes only now: generation has succeeded and the new file is written.
      if (replaced) await rm(join(ctx.root, replaced.relPath));
      const outcome = await commitAndPush({
        root: ctx.root,
        message: replaced
          ? `feat(podcast): replace ${replaced.episode.id} with ${episode.id}`
          : `feat(podcast): add ${episode.id}`,
        command: "podcast",
        push: values["no-push"] !== true,
      });
      const failure = commitFailure(outcome);
      if (failure !== null) {
        await live.stream?.failed();
        ctx.log.error(`${failure}. The episode file stays at ${relPath}.`);
        return 1;
      }
      await live.stream?.done();
      await refreshEpisodeIndex(ctx, blobClient, outcome);
      const emptyNote =
        result.empty_topics.length > 0
          ? ` No stories in ${result.empty_topics.join(", ")} in the window.`
          : "";
      const from = result.feeds ? `${result.feeds.ok} news feeds` : `${result.digests} digests`;
      emit(
        ctx,
        [
          `Selected ${episode.sources.length} of ${result.matched} matching stories from ${from}.${emptyNote}`,
          ...(result.script.short_by_chars > 0
            ? [
                `The script is ${result.script.short_by_chars} characters under the length asked for.`,
              ]
            : []),
          ...(replaced ? [`Removed ${replaced.relPath}.`] : []),
          `Wrote ${relPath}: ${episode.turns.length} turns, ${episode.char_count} characters, about ${episode.listen_minutes} min.`,
          episode.id,
        ],
        {
          outcome: outcome.status,
          episode_id: episode.id,
          ...(replaced ? { replaces: replaced.episode.id } : {}),
          path: relPath,
          stories: episode.sources.length,
          turns: episode.turns.length,
          char_count: episode.char_count,
          listen_minutes: episode.listen_minutes,
          short_by_chars: result.script.short_by_chars,
          empty_topics: result.empty_topics,
        },
      );
      return 0;
    } catch (error) {
      await live.stream?.failed();
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
