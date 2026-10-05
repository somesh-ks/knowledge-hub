import { parseArgs } from "node:util";
import { DigestId } from "@dispatch/core";
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
import type { BlobClient } from "../publish/blob.js";
import type { DigestAudioOutcome, PublishAudioResult } from "../publish/publishAudio.js";
import { listPendingDigests, publishAudio } from "../publish/publishAudio.js";
import type { AudioCommandDeps } from "./audio.js";
import { defaultAudioDeps } from "./audio.js";

const USAGE = "usage: dispatch publish [--digest <id>] [--prune <days>] [--no-push]";

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
 * `dispatch publish`: narrate every digest that lacks audio, upload it, and commit the timeline
 * files and usage count through the write guard. A failed narration leaves that digest's audio
 * null, is reported, and does not fail the command, so the text digest still ships (plan 7.9). A
 * refused commit or a failed push does fail it.
 */
export function createPublishCommand(overrides: Partial<AudioCommandDeps> = {}): CommandRun {
  const deps: AudioCommandDeps = { ...defaultAudioDeps, ...overrides };

  return async (argv, ctx) => {
    let values: { digest?: string; prune?: string; "no-push"?: boolean };
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          digest: { type: "string" },
          prune: { type: "string" },
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
    }
    let pruneDays: number | undefined;
    if (values.prune !== undefined) {
      pruneDays = Number(values.prune);
      if (!Number.isInteger(pruneDays) || pruneDays < 1) {
        ctx.log.error(`--prune needs a whole number of days, at least 1. ${USAGE}`);
        return 2;
      }
    }

    const git = createGitRunner(ctx.root);
    const pending = await listPendingDigests(ctx.root, digestId === undefined ? {} : { digestId });
    if (pending.length === 0 && pruneDays === undefined) {
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
        outcomes: pending.map((id) => ({
          status: "failed",
          digestId: id,
          stage: "credentials",
          error: keys.error,
        })),
        warnings: [keys.error],
        changedPaths: [],
      };
    } else {
      result = await publishAudio(
        {
          root: ctx.root,
          speech: keys.speech,
          blob: keys.blob,
          log: ctx.log,
          now: ctx.now,
          monthlyChars: keys.monthlyChars,
          voiceId: ctx.env.SPEECHIFY_VOICE_ID,
        },
        {
          ...(digestId !== undefined ? { digestId } : {}),
          ...(pruneDays !== undefined ? { pruneDays } : {}),
        },
      );
    }
    for (const warning of result.warnings) ctx.log.warn(warning);

    // Always ask git what changed rather than trusting the result: usage.json moves even when an
    // upload fails after synthesis, and that spend must reach the repo.
    const commit = await commitAndPush({
      root: ctx.root,
      message: commitMessage(result.outcomes),
      command: "publish",
      push: values["no-push"] !== true,
      git,
    });
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
