import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DigestId, digestRelPath, parseDigestFile, requireKey } from "@singularity/core";
import { checkBudget, describeRefusal, loadUsage, parseMonthlyChars } from "../audio/budget.js";
import type { SpeechSynthesizer } from "../audio/speechify.js";
import { createSpeechifyClient } from "../audio/speechify.js";
import { buildSpokenText } from "../audio/spokenText.js";
import type { CommandContext, CommandRun } from "../context.js";
import type { BlobClient } from "../publish/blob.js";
import { createVercelBlobClient } from "../publish/blob.js";
import type { DigestAudioOutcome } from "../publish/publishAudio.js";
import { publishAudio } from "../publish/publishAudio.js";

/** Everything a command touches outside the repo, injectable so tests never reach the network. */
export interface AudioCommandDeps {
  /** Where results go; stdout in production. Log lines always go to stderr through ctx.log. */
  out: (text: string) => void;
  monthlyChars: () => number;
  createSpeech: (ctx: CommandContext) => SpeechSynthesizer;
  createBlob: (ctx: CommandContext) => BlobClient;
}

export const defaultAudioDeps: AudioCommandDeps = {
  out: (text) => {
    process.stdout.write(text);
  },
  // core's Env does not carry SPEECHIFY_MONTHLY_CHARS yet, so this is the one place it is read.
  monthlyChars: () => parseMonthlyChars(process.env.SPEECHIFY_MONTHLY_CHARS),
  createSpeech: (ctx) =>
    createSpeechifyClient({
      apiKey: requireKey(ctx.env, "SPEECHIFY_API_KEY"),
      defaultVoiceId: ctx.env.SPEECHIFY_VOICE_ID,
      // A workflow run has no retry of its own above this, so a 5xx or a timeout gets two more tries.
      transientRetries: 2,
    }),
  createBlob: (ctx) => {
    // A long-lived token wins; otherwise the OIDC pair pulled with `vercel env pull`.
    if (ctx.env.BLOB_READ_WRITE_TOKEN) return createVercelBlobClient(ctx.env.BLOB_READ_WRITE_TOKEN);
    const { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: storeId } = ctx.env;
    if (!oidcToken || !storeId) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set (nor VERCEL_OIDC_TOKEN with BLOB_STORE_ID, from `vercel env pull`).",
      );
    }
    return createVercelBlobClient({ oidcToken, storeId });
  },
};

const USAGE = "usage: singularity audio --digest <id> [--dry-run] [--force]";

function describeOutcome(outcome: DigestAudioOutcome): string {
  switch (outcome.status) {
    case "published":
      return `${outcome.digestId}: audio ready, ${(outcome.durationMs / 1000).toFixed(1)}s, ${outcome.timeline} timeline, ${outcome.url}`;
    case "skipped":
      return `${outcome.digestId}: already has audio and a timeline (use --force to regenerate)`;
    case "refused":
      return `${outcome.digestId}: ${describeRefusal(outcome.refusal)}`;
    case "failed":
      return `${outcome.digestId}: failed at ${outcome.stage}: ${outcome.error}`;
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

/** `singularity audio --digest <id>`: narration, timeline and upload for one digest, without a commit. */
export function createAudioCommand(overrides: Partial<AudioCommandDeps> = {}): CommandRun {
  const deps: AudioCommandDeps = { ...defaultAudioDeps, ...overrides };

  return async (argv, ctx) => {
    let values: { digest?: string; "dry-run"?: boolean; force?: boolean };
    try {
      ({ values } = parseArgs({
        args: argv,
        options: {
          digest: { type: "string" },
          "dry-run": { type: "boolean" },
          force: { type: "boolean" },
        },
        strict: true,
        allowPositionals: false,
      }));
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : String(error)}. ${USAGE}`);
      return 2;
    }
    const parsedId = DigestId.safeParse(values.digest);
    if (!parsedId.success) {
      ctx.log.error(`--digest needs a digest id such as 2026-10-07. ${USAGE}`);
      return 2;
    }
    const digestId = parsedId.data;

    if (values["dry-run"]) return dryRun(digestId, ctx, deps);

    let speech: SpeechSynthesizer;
    let blob: BlobClient;
    let monthlyChars: number;
    try {
      speech = deps.createSpeech(ctx);
      blob = deps.createBlob(ctx);
      monthlyChars = deps.monthlyChars();
    } catch (error) {
      ctx.log.error(error instanceof Error ? error.message : String(error));
      return 1;
    }

    const result = await publishAudio(
      {
        root: ctx.root,
        speech,
        blob,
        log: ctx.log,
        now: ctx.now,
        monthlyChars,
        voiceId: ctx.env.SPEECHIFY_VOICE_ID,
      },
      { digestId, force: values.force === true },
    );
    const outcome = result.outcomes[0];
    if (!outcome) {
      ctx.log.error(`No digest ${digestId} found`);
      return 1;
    }
    for (const warning of result.warnings) ctx.log.warn(warning);
    deps.out(
      ctx.json
        ? `${JSON.stringify({ ok: outcome.status === "published" || outcome.status === "skipped", outcome, warnings: result.warnings })}\n`
        : `${describeOutcome(outcome)}\n`,
    );
    return outcome.status === "published" || outcome.status === "skipped" ? 0 : 1;
  };
}

async function dryRun(
  digestId: string,
  ctx: CommandContext,
  deps: AudioCommandDeps,
): Promise<number> {
  const now = ctx.now();
  let spoken: ReturnType<typeof buildSpokenText>;
  let decision: ReturnType<typeof checkBudget>;
  let monthlyChars: number;
  try {
    const digest = parseDigestFile(await readFile(join(ctx.root, digestRelPath(digestId)), "utf8"));
    spoken = buildSpokenText(digest);
    monthlyChars = deps.monthlyChars();
    decision = checkBudget({
      usage: await loadUsage(ctx.root, now),
      now,
      requested: spoken.text.length,
      monthlyChars,
    });
  } catch (error) {
    ctx.log.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const characters = spoken.text.length;
  const budget = {
    month: decision.month,
    used: decision.used,
    requested: characters,
    limit: decision.limit,
    monthlyChars,
    wouldSynthesize: decision.ok,
  };

  if (ctx.json) {
    deps.out(`${JSON.stringify({ digest: digestId, characters, budget, text: spoken.text })}\n`);
  } else {
    const verdict = decision.ok
      ? `${decision.remaining - characters} characters would remain under the limit`
      : "over the limit, audio would be refused";
    deps.out(
      `${spoken.text}\n\n${digestId}: ${characters} characters.\n` +
        `Budget ${budget.month}: ${budget.used} used, limit ${budget.limit} (90 percent of ${monthlyChars}), ${verdict}.\n`,
    );
  }
  return 0;
}

export const run: CommandRun = createAudioCommand();
