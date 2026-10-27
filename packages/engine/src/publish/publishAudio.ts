import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AudioTimeline,
  audioTimelineRelPath,
  type Digest,
  DigestId,
  digestRelPath,
  parseDigestFile,
  podcastVoices,
  STATE_FILES,
  serializeDigestFile,
} from "@singularity/core";
import { writeJsonAtomic, writeTextAtomic } from "../audio/atomicFile.js";
import type { BudgetRefusal } from "../audio/budget.js";
import {
  checkBudget,
  describeRefusal,
  loadUsage,
  type RecordUsageInput,
  recordUsage,
} from "../audio/budget.js";
import type { Mp3OutputFormat, SpeechMark, SpeechSynthesizer } from "../audio/speechify.js";
import {
  DEFAULT_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_VOICE_ID,
  isMarksUnavailable,
  SpeechifyError,
} from "../audio/speechify.js";
import type { SpokenText } from "../audio/spokenText.js";
import { buildSpokenText } from "../audio/spokenText.js";
import { resolveTimeline } from "../audio/timeline.js";
import type { EpisodeOpusFile } from "../audio/transcode.js";
import type { Logger } from "../context.js";
import { costKindOf } from "../cost/ledger.js";
import { loadSchedule } from "../schedule/store.js";
import type { BlobClient, PruneResult } from "./blob.js";
import { pruneAudio, uploadAudio, uploadOpusAudio } from "./blob.js";

export interface PublishAudioDeps {
  root: string;
  speech: SpeechSynthesizer;
  blob: BlobClient;
  log: Logger;
  now: () => Date;
  /** Monthly character allowance; synthesis stops at 90 percent of it. */
  monthlyChars: number;
  voiceId?: string;
  model?: string;
  outputFormat?: Mp3OutputFormat;
  cacheControlMaxAge?: number;
  /**
   * MP3 bytes to Opus in MP4 (audio/transcode.ts). When set, the narration is also published
   * as .m4a; a failure here leaves the MP3 alone, so the briefing still has audio.
   */
  transcodeOpus?: (mp3: Uint8Array) => Promise<Uint8Array>;
  /**
   * An episode's turns, in order, to ONE Opus in MP4 file (audio/transcode.ts), and a way to read a
   * stored turn back. Both set, a finished episode is also published as one .m4a with the turns'
   * offsets; a failure leaves the MP3 turns alone, so the episode still plays.
   */
  transcodeEpisodeOpus?: (mp3s: Uint8Array[]) => Promise<EpisodeOpusFile>;
  fetchAudio?: (url: string) => Promise<Uint8Array>;
  sleep?: (ms: number) => Promise<void>;
}

export interface PublishAudioOptions {
  /** Only this digest. Without it, every digest is considered. */
  digestId?: string;
  /** Regenerate even when audio and its timeline already exist. */
  force?: boolean;
  /** Delete narrations in the blob store older than this many days. */
  pruneDays?: number;
}

export type AudioFailureStage =
  | "credentials"
  | "read"
  | "spoken_text"
  | "budget"
  | "synthesis"
  | "timeline"
  | "upload"
  | "write";

export type DigestAudioOutcome =
  | {
      status: "published";
      digestId: string;
      url: string;
      durationMs: number;
      timeline: "marks" | "estimated";
      characters: number;
      degradedReason?: string;
    }
  | { status: "skipped"; digestId: string; reason: "complete" }
  | { status: "refused"; digestId: string; refusal: BudgetRefusal }
  | { status: "failed"; digestId: string; stage: AudioFailureStage; error: string };

export interface PublishAudioResult {
  outcomes: DigestAudioOutcome[];
  warnings: string[];
  pruned?: PruneResult;
  /** Repo-relative files this run wrote, for the commit step. */
  changedPaths: string[];
}

export interface DigestTarget {
  id: string;
  relPath: string;
}

const FILE_NAME = /^(\d{4}-\d{2}-\d{2}(?:-weekly|-\d+)?)\.md$/;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function subdirectories(path: string, pattern: RegExp): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Every digest file under Digests/YYYY/MM/, newest id first so a tight budget favours the latest. */
export async function listDigestTargets(root: string): Promise<DigestTarget[]> {
  const targets: DigestTarget[] = [];
  for (const year of await subdirectories(join(root, "Digests"), /^\d{4}$/)) {
    for (const month of await subdirectories(join(root, "Digests", year), /^\d{2}$/)) {
      const entries = await readdir(join(root, "Digests", year, month));
      for (const name of entries) {
        const id = FILE_NAME.exec(name)?.[1];
        if (id === undefined || !DigestId.safeParse(id).success) continue;
        // The id fixes the directory, so a misfiled digest is not picked up.
        if (digestRelPath(id) === `Digests/${year}/${month}/${name}`) {
          targets.push({ id, relPath: digestRelPath(id) });
        }
      }
    }
  }
  return targets.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

interface Inspection {
  digest: Digest;
  timelineExists: boolean;
}

async function inspect(root: string, target: DigestTarget): Promise<Inspection> {
  let text: string;
  try {
    text = await readFile(join(root, target.relPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Digest file ${target.relPath} does not exist`);
    }
    throw error;
  }
  const digest = parseDigestFile(text);
  if (digest.id !== target.id) {
    throw new Error(`${target.relPath} holds digest id ${digest.id}, expected ${target.id}`);
  }
  return { digest, timelineExists: await exists(join(root, audioTimelineRelPath(target.id))) };
}

function isComplete(inspection: Inspection): boolean {
  return inspection.digest.audio !== null && inspection.timelineExists;
}

function resolveTargets(all: DigestTarget[], digestId: string | undefined): DigestTarget[] {
  if (digestId === undefined) return all;
  const id = DigestId.parse(digestId);
  return [all.find((target) => target.id === id) ?? { id, relPath: digestRelPath(id) }];
}

/** Ids that still need narration: audio is null or the timeline file is missing. */
export async function listPendingDigests(
  root: string,
  options: Pick<PublishAudioOptions, "digestId" | "force"> = {},
): Promise<string[]> {
  const pending: string[] = [];
  for (const target of resolveTargets(await listDigestTargets(root), options.digestId)) {
    try {
      if (options.force || !isComplete(await inspect(root, target))) pending.push(target.id);
    } catch {
      // An unreadable digest is reported when publishing runs, not hidden here.
      pending.push(target.id);
    }
  }
  return pending;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Narration {
  audio: Uint8Array;
  marks: SpeechMark[];
  durationMs: number;
  billableCharacters: number;
}

async function synthesizeNarration(
  deps: PublishAudioDeps,
  spoken: SpokenText,
  voiceId: string,
  model: string,
  outputFormat: Mp3OutputFormat,
): Promise<Narration> {
  const request = { text: spoken.text, voiceId, model, outputFormat };
  try {
    return await deps.speech.synthesizeWithMarks(request);
  } catch (error) {
    if (!isMarksUnavailable(error)) throw error;
    // The plan's documented fallback: plain audio now, an estimated timeline from character share.
    deps.log.warn("Speech marks unavailable, using the plain stream and an estimated timeline", {
      reason: message(error),
    });
    return { ...(await deps.speech.synthesize(request)), marks: [] };
  }
}

async function uploadWithRetry(
  deps: PublishAudioDeps,
  digestId: string,
  audio: Uint8Array,
): Promise<string> {
  // Upload attempts before giving up; a paid narration should survive one blip.
  const attempts = 3;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await uploadAudio(deps.blob, {
        digestId,
        audio,
        ...(deps.cacheControlMaxAge !== undefined
          ? { cacheControlMaxAge: deps.cacheControlMaxAge }
          : {}),
      });
    } catch (error) {
      if (attempt >= attempts) throw error;
      deps.log.warn(`Blob upload attempt ${attempt} failed, retrying`, { reason: message(error) });
      await sleep(1000 * attempt);
    }
  }
}

/**
 * A stream that dies midway has still synthesized (and been billed for) the characters its marks
 * covered. Count that lower bound so a retry loop cannot quietly outrun the monthly allowance.
 */
export async function recordPartialSpend(
  deps: PublishAudioDeps,
  error: unknown,
  ledger?: RecordUsageInput["ledger"],
): Promise<void> {
  if (!(error instanceof SpeechifyError) || !error.partialCharacters) return;
  try {
    await recordUsage({
      root: deps.root,
      now: deps.now(),
      characters: error.partialCharacters,
      ledger,
    });
  } catch (recordError) {
    deps.log.warn("Could not record the partial spend of a failed stream", {
      reason: message(recordError),
    });
  }
}

interface DigestResult {
  outcome: DigestAudioOutcome;
  changed: string[];
}

const failed = (digestId: string, stage: AudioFailureStage, error: unknown): DigestResult => ({
  outcome: { status: "failed", digestId, stage, error: message(error) },
  changed: [],
});

/**
 * The voice config/schedule.json gives a briefing: the shared Podcast voice (podcastVoices, which
 * the site's narrate route asks too, so the stored audio's names match). Undefined when the file is
 * missing or invalid, or sets none; then the SPEECHIFY_VOICE_ID of the run, or the engine's
 * default, reads it.
 */
async function scheduledVoice(
  root: string,
  kind: Digest["kind"],
  log: Logger,
): Promise<string | undefined> {
  try {
    const schedule = await loadSchedule(root);
    return podcastVoices(schedule, kind === "weekly" ? "weekly" : "daily").voice_id ?? undefined;
  } catch (error) {
    log.warn("The schedule could not be read; narrating in the default voice", {
      reason: message(error),
    });
    return undefined;
  }
}

async function processDigest(
  deps: PublishAudioDeps,
  target: DigestTarget,
  options: PublishAudioOptions,
): Promise<DigestResult> {
  const { root, log } = deps;
  const digestId = target.id;

  let inspection: Inspection;
  try {
    inspection = await inspect(root, target);
  } catch (error) {
    return failed(digestId, "read", error);
  }
  if (isComplete(inspection) && !options.force) {
    return { outcome: { status: "skipped", digestId, reason: "complete" }, changed: [] };
  }
  const { digest } = inspection;

  let spoken: SpokenText;
  try {
    spoken = buildSpokenText(digest);
  } catch (error) {
    return failed(digestId, "spoken_text", error);
  }

  let decision: ReturnType<typeof checkBudget>;
  try {
    const usage = await loadUsage(root, deps.now());
    decision = checkBudget({
      usage,
      now: deps.now(),
      requested: spoken.text.length,
      monthlyChars: deps.monthlyChars,
    });
  } catch (error) {
    return failed(digestId, "budget", error);
  }
  if (!decision.ok)
    return { outcome: { status: "refused", digestId, refusal: decision }, changed: [] };

  const voice = (await scheduledVoice(root, digest.kind, log)) ?? deps.voiceId ?? DEFAULT_VOICE_ID;
  const model = deps.model ?? DEFAULT_MODEL;
  log.info(`Synthesizing ${digestId}`, { characters: spoken.text.length });
  const ledger = { runId: digestId, kind: costKindOf(digest.kind), product: model };

  let narration: Narration;
  try {
    narration = await synthesizeNarration(
      deps,
      spoken,
      voice,
      model,
      deps.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    );
  } catch (error) {
    await recordPartialSpend(deps, error, ledger);
    return failed(digestId, "synthesis", error);
  }

  // Record the spend before anything that can fail: the characters are billed whether or not the
  // upload below succeeds, and the next run must see them.
  try {
    await recordUsage({
      root,
      now: deps.now(),
      characters: narration.billableCharacters,
      ledger,
    });
  } catch (error) {
    return failed(digestId, "write", error);
  }

  let resolved: ReturnType<typeof resolveTimeline>;
  try {
    resolved = resolveTimeline({
      digest,
      spoken,
      marks: narration.marks,
      durationMs: narration.durationMs,
      voice,
      model,
    });
  } catch (error) {
    return failed(digestId, "timeline", error);
  }

  let url: string;
  try {
    url = await uploadWithRetry(deps, digestId, narration.audio);
  } catch (error) {
    return failed(digestId, "upload", error);
  }

  let m4aUrl: string | undefined;
  const transcode = deps.transcodeOpus;
  if (transcode) {
    try {
      m4aUrl = await uploadOpusAudio(deps.blob, {
        digestId,
        audio: await transcode(narration.audio),
        ...(deps.cacheControlMaxAge !== undefined
          ? { cacheControlMaxAge: deps.cacheControlMaxAge }
          : {}),
      });
    } catch (error) {
      deps.log.warn("Opus skipped, the MP3 plays alone", { reason: message(error) });
    }
  }

  const timelinePath = audioTimelineRelPath(digestId);
  try {
    // Timeline first: a crash in between leaves audio null, so the next run converges.
    await writeJsonAtomic(join(root, timelinePath), AudioTimeline.parse(resolved.timeline));
    await writeTextAtomic(
      join(root, target.relPath),
      serializeDigestFile({
        ...digest,
        audio: {
          url,
          duration_ms: resolved.timeline.duration_ms,
          ...(m4aUrl ? { m4a_url: m4aUrl } : {}),
        },
      }),
    );
  } catch (error) {
    return failed(digestId, "write", error);
  }

  return {
    outcome: {
      status: "published",
      digestId,
      url,
      durationMs: resolved.timeline.duration_ms,
      timeline: resolved.timeline.timeline,
      characters: narration.billableCharacters,
      ...(resolved.degradedReason !== undefined ? { degradedReason: resolved.degradedReason } : {}),
    },
    changed: [timelinePath, target.relPath, STATE_FILES.usage],
  };
}

/**
 * Give every digest that lacks it a narration. Sequential on purpose (the free plan allows one
 * request per second), idempotent (a complete digest is skipped), and isolated: one digest failing
 * never stops the rest, and a failure leaves that digest's audio null so it still publishes.
 */
export async function publishAudio(
  deps: PublishAudioDeps,
  options: PublishAudioOptions = {},
): Promise<PublishAudioResult> {
  const targets = resolveTargets(await listDigestTargets(deps.root), options.digestId);
  const outcomes: DigestAudioOutcome[] = [];
  const warnings: string[] = [];
  const changed = new Set<string>();

  for (const target of targets) {
    const result = await processDigest(deps, target, options);
    outcomes.push(result.outcome);
    for (const path of result.changed) changed.add(path);
    const { outcome } = result;
    switch (outcome.status) {
      case "published":
        if (outcome.degradedReason !== undefined) {
          warnings.push(`${outcome.digestId}: estimated timeline (${outcome.degradedReason})`);
        }
        break;
      case "refused":
        warnings.push(`${outcome.digestId}: audio skipped. ${describeRefusal(outcome.refusal)}`);
        break;
      case "failed":
        warnings.push(`${outcome.digestId}: audio failed at ${outcome.stage}: ${outcome.error}`);
        break;
      case "skipped":
        break;
      default: {
        const unreachable: never = outcome;
        throw new Error(`Unhandled outcome ${JSON.stringify(unreachable)}`);
      }
    }
  }

  let pruned: PruneResult | undefined;
  if (options.pruneDays !== undefined) {
    try {
      pruned = await pruneAudio(deps.blob, { olderThanDays: options.pruneDays, now: deps.now() });
    } catch (error) {
      warnings.push(`prune failed: ${message(error)}`);
    }
  }

  return {
    outcomes,
    warnings,
    ...(pruned ? { pruned } : {}),
    changedPaths: [...changed].sort(),
  };
}
