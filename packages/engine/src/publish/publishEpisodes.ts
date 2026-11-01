import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EpisodeId, episodeRelPath, STATE_FILES } from "@singularity/core";
import { checkBudget, describeRefusal, loadUsage, recordUsage } from "../audio/budget.js";
import {
  deriveSegmentMarks,
  type EpisodePlan,
  type EpisodeVoiceEnv,
  episodeOpusAddress,
  episodeOpusManifest,
  type PlannedSegment,
  planEpisodeNarration,
  SEGMENT_CACHE_SECONDS,
  segmentMarksPath,
} from "../audio/segmentStore.js";
import type { SpeechMark, SynthesisRequest } from "../audio/speechify.js";
import { DEFAULT_MODEL, DEFAULT_OUTPUT_FORMAT, isMarksUnavailable } from "../audio/speechify.js";
import { OPUS_CONTENT_TYPE } from "../audio/transcode.js";
import type { BlobClient } from "./blob.js";
import type { DigestAudioOutcome, PublishAudioDeps, PublishAudioResult } from "./publishAudio.js";
import { recordPartialSpend } from "./publishAudio.js";

/**
 * Narrates a new episode (Podcasts/) ahead of time, turn by turn, into the very files the site's
 * /api/narrate would make on Play: audio/<ep-id>/seg/t<idx>.<hash>.mp3 and its .marks.json, named
 * by the shared segmentStore.ts and read from the file by the shared core reader. The site finds
 * them by their address alone and plays them without narrating, so no player change is needed and
 * nothing is committed but the month's usage. The site's daily narration cap is not charged; the
 * monthly Speechify allowance in state/usage.json is, as a briefing's narration is.
 */

/** How far back a run looks for episodes that lack audio. Each one costs a store listing a run. */
export const EPISODE_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

/** The ids of every episode file under Podcasts/YYYY/MM/, newest first. */
export async function listEpisodeIds(root: string): Promise<string[]> {
  const ids: string[] = [];
  const dirs = async (path: string): Promise<string[]> => {
    try {
      return (await readdir(path, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  for (const year of await dirs(join(root, "Podcasts"))) {
    for (const month of await dirs(join(root, "Podcasts", year))) {
      for (const name of await readdir(join(root, "Podcasts", year, month))) {
        const id = name.replace(/\.md$/, "");
        if (!name.endsWith(".md") || !EpisodeId.safeParse(id).success) continue;
        // The id fixes the directory, so a misfiled episode is not picked up.
        if (episodeRelPath(id) === `Podcasts/${year}/${month}/${name}`) ids.push(id);
      }
    }
  }
  return ids.sort().reverse();
}

/** The day an episode was made, from its id (ep-YYYYMMDD-HHmm), as a UTC day number. */
const episodeDay = (id: string): number =>
  Date.UTC(Number(id.slice(3, 7)), Number(id.slice(7, 9)) - 1, Number(id.slice(9, 11))) / DAY_MS;

/**
 * The episodes a run should look at: the one named, or every episode made in the last
 * EPISODE_WINDOW_DAYS. Older episodes are left to the site, so a run does not list the store for
 * every episode ever made.
 */
export async function listEpisodeCandidates(
  root: string,
  now: Date,
  episodeId?: string,
): Promise<string[]> {
  if (episodeId !== undefined) return [EpisodeId.parse(episodeId)];
  const today = Math.floor(now.getTime() / DAY_MS);
  return (await listEpisodeIds(root)).filter((id) => episodeDay(id) >= today - EPISODE_WINDOW_DAYS);
}

/** Every blob under the episode's folder (pathname to URL), listed once per run so it is one operation, not two. */
export async function listEpisodeBlobs(
  blob: BlobClient,
  episodeId: string,
): Promise<Map<string, string>> {
  const stored = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await blob.list({ prefix: `audio/${episodeId}/`, ...(cursor ? { cursor } : {}) });
    for (const item of page.blobs) stored.set(item.pathname, item.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor !== undefined);
  return stored;
}

/** The planned segments the store does not hold yet, from the episode's one listing. */
export function missingSegments(
  stored: ReadonlyMap<string, string>,
  plan: EpisodePlan,
): PlannedSegment[] {
  return plan.segments.filter((segment) => !stored.has(segment.path));
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function narrateSegment(
  deps: PublishAudioDeps,
  segment: PlannedSegment,
): Promise<{
  audio: Uint8Array;
  marks: SpeechMark[];
  durationMs: number;
  billableCharacters: number;
}> {
  const request: SynthesisRequest = {
    text: segment.text,
    voiceId: segment.voice,
    model: DEFAULT_MODEL,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
  };
  try {
    return await deps.speech.synthesizeWithMarks(request);
  } catch (error) {
    if (!isMarksUnavailable(error)) throw error;
    return { ...(await deps.speech.synthesize(request)), marks: [] };
  }
}

async function putWithRetry(
  deps: PublishAudioDeps,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const stored = await deps.blob.put(path, body, {
        contentType,
        cacheControlMaxAge: SEGMENT_CACHE_SECONDS,
      });
      return stored.url;
    } catch (error) {
      if (attempt >= 3) throw error;
      deps.log.warn(`Blob upload attempt ${attempt} failed, retrying`, { reason: message(error) });
      await sleep(1000 * attempt);
    }
  }
}

/**
 * Also store a finished episode as one Opus file with the turns' offsets (see EpisodeOpusManifest).
 * Never fatal: the MP3 turns are the episode, and the site falls back to them. Idempotent: the
 * manifest, written last, says the file is there. `made` holds the turns this run narrated, so
 * they are not read back.
 */
export async function publishEpisodeOpus(
  deps: PublishAudioDeps,
  plan: EpisodePlan,
  made: ReadonlyMap<string, Uint8Array>,
  stored?: ReadonlyMap<string, string>,
): Promise<"published" | "present" | "skipped"> {
  const { transcodeEpisodeOpus, fetchAudio } = deps;
  if (!transcodeEpisodeOpus || !fetchAudio) return "skipped";
  try {
    const address = episodeOpusAddress(
      plan.id,
      plan.segments.map((segment) => segment.path),
    );
    const urls = stored ?? (await listEpisodeBlobs(deps.blob, plan.id));
    if (urls.has(address.manifestPath)) return "present";

    const mp3s: Uint8Array[] = [];
    for (const segment of plan.segments) {
      const url = urls.get(segment.path);
      const bytes = made.get(segment.path) ?? (url ? await fetchAudio(url) : undefined);
      if (!bytes) throw new Error(`${segment.key} is not stored`);
      mp3s.push(bytes);
    }
    // The lengths come from the joined files themselves: a size-based estimate drifts by the
    // encoder padding of every turn, and the transcript would run ahead of the voice.
    const { audio: m4a, durations_ms } = await transcodeEpisodeOpus(mp3s);
    if (durations_ms.length !== plan.segments.length) throw new Error("a turn has no length");
    const manifest = episodeOpusManifest(
      plan.segments.map((segment, index) => ({
        key: segment.key,
        duration_ms: durations_ms[index] ?? 0,
      })),
    );
    await putWithRetry(deps, address.path, m4a, OPUS_CONTENT_TYPE);
    await putWithRetry(
      deps,
      address.manifestPath,
      new TextEncoder().encode(JSON.stringify(manifest)),
      "application/json",
    );
    return "published";
  } catch (error) {
    deps.log.warn(`${plan.id}: Opus skipped, the MP3 turns play alone`, { reason: message(error) });
    return "skipped";
  }
}

type Outcome = DigestAudioOutcome;
const failed =
  (id: string, stage: "read" | "budget" | "synthesis" | "upload" | "write") =>
  (error: unknown): Outcome => ({ status: "failed", digestId: id, stage, error: message(error) });

async function processEpisode(
  deps: PublishAudioDeps,
  env: EpisodeVoiceEnv,
  id: string,
): Promise<Outcome> {
  let missing: PlannedSegment[];
  let plan: EpisodePlan;
  let stored: Map<string, string>;
  try {
    plan = planEpisodeNarration(await readFile(join(deps.root, episodeRelPath(id)), "utf8"), env);
    if (plan.id !== id) throw new Error(`${episodeRelPath(id)} holds episode ${plan.id}`);
    stored = await listEpisodeBlobs(deps.blob, id);
    missing = missingSegments(stored, plan);
  } catch (error) {
    return failed(id, "read")(error);
  }
  if (missing.length === 0) {
    // Complete before this run: an episode made before Opus gets its file now.
    await publishEpisodeOpus(deps, plan, new Map(), stored);
    return { status: "skipped", digestId: id, reason: "complete" };
  }

  const requested = missing.reduce((sum, segment) => sum + segment.text.length, 0);
  try {
    const decision = checkBudget({
      usage: await loadUsage(deps.root, deps.now()),
      now: deps.now(),
      requested,
      monthlyChars: deps.monthlyChars,
    });
    if (!decision.ok) return { status: "refused", digestId: id, refusal: decision };
  } catch (error) {
    return failed(id, "budget")(error);
  }

  deps.log.info(`Synthesizing ${id}`, { characters: requested, segments: missing.length });
  const ledger = { runId: id, kind: "on_demand" as const, product: deps.model ?? DEFAULT_MODEL };
  let characters = 0;
  let durationMs = 0;
  let firstUrl = "";
  const made = new Map<string, Uint8Array>();
  // In playing order, one at a time: a failure leaves the rest for the next run or for Play.
  for (const segment of missing) {
    let narration: Awaited<ReturnType<typeof narrateSegment>>;
    try {
      narration = await narrateSegment(deps, segment);
    } catch (error) {
      await recordPartialSpend(deps, error, ledger);
      return failed(id, "synthesis")(error);
    }
    try {
      await recordUsage({
        root: deps.root,
        now: deps.now(),
        characters: narration.billableCharacters,
        ledger,
      });
    } catch (error) {
      return failed(id, "write")(error);
    }
    characters += narration.billableCharacters;
    durationMs += narration.durationMs;
    try {
      const url = await putWithRetry(deps, segment.path, narration.audio, "audio/mpeg");
      firstUrl ||= url;
      made.set(segment.path, narration.audio);
    } catch (error) {
      return failed(id, "upload")(error);
    }
    // The marks light the transcript; without them the page estimates, so a failure only warns.
    const words = deriveSegmentMarks(segment.text, narration.marks);
    if (words.length > 0) {
      try {
        const body = new TextEncoder().encode(JSON.stringify({ words }));
        await putWithRetry(deps, segmentMarksPath(segment.path), body, "application/json");
      } catch (error) {
        deps.log.warn(`${id} ${segment.key}: word marks not stored`, { reason: message(error) });
      }
    }
  }
  await publishEpisodeOpus(deps, plan, made, stored);
  return {
    status: "published",
    digestId: id,
    url: firstUrl,
    durationMs,
    timeline: "marks",
    characters,
  };
}

/**
 * Narrate every candidate episode's missing turns. Sequential, idempotent (a turn already stored is
 * never narrated again) and isolated: one episode failing never stops the rest or fails the run.
 */
export async function publishEpisodeAudio(
  deps: PublishAudioDeps,
  env: EpisodeVoiceEnv,
  ids: readonly string[],
): Promise<PublishAudioResult> {
  const outcomes: Outcome[] = [];
  const warnings: string[] = [];
  let spent = false;
  for (const id of ids) {
    const outcome = await processEpisode(deps, env, id);
    outcomes.push(outcome);
    if (outcome.status === "published") spent = true;
    if (outcome.status === "refused")
      warnings.push(`${id}: audio skipped. ${describeRefusal(outcome.refusal)}`);
    if (outcome.status === "failed") {
      spent = true;
      warnings.push(`${id}: audio failed at ${outcome.stage}: ${outcome.error}`);
    }
  }
  return { outcomes, warnings, changedPaths: spent ? [STATE_FILES.usage] : [] };
}
