import { access } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DigestId, digestRelPath, EpisodeId, episodeRelPath } from "@singularity/core";
import { describeRefusal } from "../audio/budget.js";
import type { SpeechSynthesizer } from "../audio/speechify.js";
import type { CommandContext, CommandRun } from "../context.js";
import type { CommitOutcome } from "../git/commit.js";
import { commitAndPush } from "../git/commit.js";
import {
  ALLOWLISTS,
  findDigestContentViolations,
  findViolations,
  readChangedPaths,
} from "../git/guard.js";
import { createGitRunner } from "../git/runGit.js";
import { type BlobClient, isPruneDay } from "../publish/blob.js";
import type { DigestAudioOutcome, PublishAudioResult } from "../publish/publishAudio.js";
import { listPendingDigests, publishAudio } from "../publish/publishAudio.js";
import { listEpisodeCandidates, publishEpisodeAudio } from "../publish/publishEpisodes.js";
import type { AudioCommandDeps } from "./audio.js";
import { defaultAudioDeps } from "./audio.js";

const USAGE =
  "usage: singularity publish [--digest <id> | --episode <ep-id>] [--prune <days> [--prune-now]] [--no-push]";

const fileExists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

interface Credentials {
  speech: SpeechSynthesizer;
  blob: BlobClient;
  monthlyChars: number;
}

/** Credentials and settings, or the reason they are unusable. Messages name variables, never values. */
function credentials(ctx: CommandContext, deps: AudioCommandDeps): Credentials | { error: string } {
  try {
    return {
      speech: deps.createSpeech(ctx),
      blob: deps.createBlob(ctx),
      monthlyChars: deps.monthlyChars(),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function commitMessage(outcomes: readonly DigestAudioOutcome[]): string {
  const ids = outcomes.flatMap((outcome) =>
    outcome.status === "published" ? [outcome.digestId] : [],
  );
  if (ids.length === 0) return "chore(audio): record speechify usage";
  const label = ids.length <= 3 ? [...ids].sort().join(", ") : `${ids.length} digests`;
  return `chore(audio): add narration for ${label}`;
}

function describeCommit(outcome: CommitOutcome): string {
  switch (outcome.status) {
    case "nothing_to_commit":
      return "nothing to commit";
    case "refused":
      return `commit refused (${outcome.reason}): ${outcome.offending.join(", ")}`;
    case "committed":
      return `committed ${outcome.sha.slice(0, 7)}, not pushed`;
    case "pushed":
      return `pushed ${outcome.sha.slice(0, 7)}${outcome.retries > 0 ? ` after ${outcome.retries} rebase retries` : ""}`;
    case "push_failed":
      return `committed ${outcome.sha.slice(0, 7)} but push failed (${outcome.reason}): ${outcome.detail}`;
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled commit outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

function describeOutcome(outcome: DigestAudioOutcome): string {
  switch (outcome.status) {
    case "published":
      return `${outcome.digestId}  audio ready  ${(outcome.durationMs / 1000).toFixed(1)}s  ${outcome.timeline}`;
    case "skipped":
      return `${outcome.digestId}  skipped, already complete`;
    case "refused":
      return `${outcome.digestId}  skipped, ${describeRefusal(outcome.refusal)}`;
    case "failed":
      return `${outcome.digestId}  audio failed at ${outcome.stage}: ${outcome.error}`;
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

function commitFailed(outcome: CommitOutcome): boolean {
  return outcome.status === "refused" || outcome.status === "push_failed";
}

/**
 * `singularity publish`: narrate every digest that lacks audio, and every turn of a recent episode
 * that has none stored (publishEpisodes.ts), upload it, and commit the timeline files and usage
 * count through the write guard. A failed narration leaves that digest's audio
 * null, is reported, and does not fail the command, so the text digest still ships (plan 7.9). A
 * refused commit or a failed push does fail it.
 */
export function createPublishCommand(overrides: Partial<AudioCommandDeps> = {}): CommandRun {
  const deps: AudioCommandDeps = { ...defaultAudioDeps, ...overrides };

  return async (argv, ctx) => {
    let values: {
      digest?: string;
      episode?: string;
      prune?: string;
      "prune-now"?: boolean;
      "no-push"?: boolean;
    };
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          digest: { type: "string" },
          episode: { type: "string" },
          prune: { type: "string" },
          "prune-now": { type: "boolean" },
          "no-push": { type: "boolean" },
        },
        strict: true,
        allowPositionals: false,
      }));
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : String(error)}. ${USAGE}`);
      return 2;
    }

    let digestId: string | undefined;
    if (values.digest !== undefined) {
      const parsed = DigestId.safeParse(values.digest);
      if (!parsed.success) {
        ctx.log.error(`--digest needs a digest id such as 2026-10-07. ${USAGE}`);
        return 2;
      }
      digestId = parsed.data;
      // Naming a digest that does not exist is a mistake to surface, not an audio failure to absorb.
      if (!(await fileExists(join(ctx.root, digestRelPath(digestId))))) {
        ctx.log.error(`No digest ${digestId} found at ${digestRelPath(digestId)}`);
        return 1;
      }
    }
    let episodeId: string | undefined;
    if (values.episode !== undefined) {
      const parsed = EpisodeId.safeParse(values.episode);
      if (!parsed.success || digestId !== undefined) {
        ctx.log.error(`--episode needs one episode id such as ep-20261007-1930. ${USAGE}`);
        return 2;
      }
      episodeId = parsed.data;
      if (!(await fileExists(join(ctx.root, episodeRelPath(episodeId))))) {
        ctx.log.error(`No episode ${episodeId} found at ${episodeRelPath(episodeId)}`);
        return 1;
      }
    }
    let pruneDays: number | undefined;
    if (values.prune !== undefined) {
      pruneDays = Number(values.prune);
      if (!Number.isInteger(pruneDays) || pruneDays < 1) {
        ctx.log.error(`--prune needs a whole number of days, at least 1. ${USAGE}`);
        return 2;
      }
      // Listing all of audio/ costs Blob operations; a weekly sweep prunes the same files.
      if (!values["prune-now"] && !isPruneDay(ctx.now())) {
        ctx.log.info("Prune runs on Sundays (or with --prune-now); skipping it today");
        pruneDays = undefined;
      }
    }

    const git = createGitRunner(ctx.root);
    // A named episode narrates that episode only; a named digest, that digest only.
    const pending =
      episodeId === undefined
        ? await listPendingDigests(ctx.root, digestId === undefined ? {} : { digestId })
        : [];
    const episodes =
      digestId === undefined ? await listEpisodeCandidates(ctx.root, ctx.now(), episodeId) : [];
    if (pending.length === 0 && episodes.length === 0 && pruneDays === undefined) {
      emit(
        ctx,
        deps,
        { outcomes: [], warnings: [], changedPaths: [] },
        undefined,
        "Nothing to publish.",
      );
      return 0;
    }

    // Fail before spending any Speechify budget when the tree already holds changes the bot could
    // never commit; discovering that after synthesis would waste the characters.
    let blocked: string[];
    try {
      const changed = await readChangedPaths(git);
      blocked = findViolations(changed, ALLOWLISTS.publish);
      if (blocked.length === 0) {
        blocked = await findDigestContentViolations({ root: ctx.root, run: git, changed });
      }
    } catch (error) {
      ctx.log.error(
        `Cannot read git status: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    if (blocked.length > 0) {
      ctx.log.error(
        `Working tree has changes outside the publish allowlist: ${blocked.join(", ")}`,
      );
      return 1;
    }

    const keys = credentials(ctx, deps);
    let result: PublishAudioResult;
    if ("error" in keys) {
      // Missing credentials block narration, never the text digest: report and carry on.
      result = {
        outcomes: [...pending, ...episodes].map((id) => ({
          status: "failed",
          digestId: id,
          stage: "credentials",
          error: keys.error,
        })),
        warnings: [keys.error],
        changedPaths: [],
      };
    } else {
      const audioDeps = {
        root: ctx.root,
        speech: keys.speech,
        blob: keys.blob,
        log: ctx.log,
        now: ctx.now,
        monthlyChars: keys.monthlyChars,
        voiceId: ctx.env.SPEECHIFY_VOICE_ID,
        ...(deps.transcodeOpus ? { transcodeOpus: deps.transcodeOpus } : {}),
        ...(deps.transcodeEpisodeOpus ? { transcodeEpisodeOpus: deps.transcodeEpisodeOpus } : {}),
        ...(deps.fetchAudio ? { fetchAudio: deps.fetchAudio } : {}),
      };
      const digests: PublishAudioResult =
        episodeId === undefined
          ? await publishAudio(audioDeps, {
              ...(digestId !== undefined ? { digestId } : {}),
              ...(pruneDays !== undefined ? { pruneDays } : {}),
            })
          : { outcomes: [], warnings: [], changedPaths: [] };
      // After the briefings, so a tight month favours them: the budget then refuses an episode.
      const told = await publishEpisodeAudio(audioDeps, ctx.env, episodes);
      result = {
        ...digests,
        outcomes: [...digests.outcomes, ...told.outcomes],
        warnings: [...digests.warnings, ...told.warnings],
        changedPaths: [...new Set([...digests.changedPaths, ...told.changedPaths])].sort(),
      };
    }
    for (const warning of result.warnings) ctx.log.warn(warning);

    // Always ask git what changed rather than trusting the result: usage.json moves even when an
    // upload fails after synthesis, and that spend must reach the repo.
    let commit: CommitOutcome;
    try {
      commit = await commitAndPush({
        root: ctx.root,
        message: commitMessage(result.outcomes),
        command: "publish",
        push: values["no-push"] !== true,
        git,
      });
    } catch (error) {
      // A failing pre-commit hook or a broken git leaves the files written and the tree dirty.
      ctx.log.error(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
      emit(ctx, deps, result, undefined);
      return 1;
    }
    emit(ctx, deps, result, commit);
    if (commitFailed(commit)) ctx.log.error(describeCommit(commit));
    return commitFailed(commit) ? 1 : 0;
  };
}

function emit(
  ctx: CommandContext,
  deps: AudioCommandDeps,
  result: PublishAudioResult,
  commit: CommitOutcome | undefined,
  note?: string,
): void {
  if (ctx.json) {
    deps.out(`${JSON.stringify({ ...result, commit, note })}\n`);
    return;
  }
  const lines = result.outcomes.map(describeOutcome);
  if (result.pruned)
    lines.push(`pruned ${result.pruned.deleted.length} old narrations, kept ${result.pruned.kept}`);
  if (commit) lines.push(`git: ${describeCommit(commit)}`);
  if (note) lines.push(note);
  deps.out(`${lines.join("\n")}\n`);
}

export const run: CommandRun = createPublishCommand();
