import type { PodcastCreateResponse, PodcastRequest } from "../types/contracts";
import { cancelTokenFor } from "./cancelToken";
import { missingSettings, readServerConfig, secretsOf } from "./config";
import {
  type GenerateDeps,
  type GenerateInput,
  isSameOrigin,
  MAX_BODY_CHARS,
  regenerationAllowance,
  regenerationLimit,
} from "./generate";
import { createGitHubClient, PODCAST_WORKFLOW_FILE, type WorkflowRun } from "./github";
import type { ApiResult } from "./http";
import {
  CATCH_UP_POLICY,
  DELETE_POLICY,
  evaluateLimits,
  PODCAST_POLICY,
  REGENERATE_POLICY,
} from "./limits";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";
import { resolveHostNames } from "./voices";

/**
 * POST /api/podcast: check the request, check the episode limits against
 * GitHub, singularity podcast.yml with the request as its one input. Built like /api/generate and with
 * the same guards, and tested the same way: every side effect is a parameter. A new discussion also
 * names its hosts after its voices here, because the workflow has no Speechify key to do it.
 */

/** `episodeIds` lists the episodes this build knows; delete and regenerate refuse any other id. */
export type PodcastDeps = GenerateDeps & {
  episodeIds?: () => readonly string[] | Promise<readonly string[]>;
  /** Marks a deleted episode in the content store at once (tombstones.ts), before the commit lands. */
  tombstone?: (id: string) => Promise<void>;
};
export type PodcastInput = GenerateInput;
type PodcastResult = ApiResult<PodcastCreateResponse>;

/** podcast.yml names a run "episode" for a new Catch up and "regenerate <id>" or "delete <id>" for the rest (its run-name). */
const isNewEpisodeRun = (run: WorkflowRun): boolean => run.title === "episode";

/** A run that came out, or is still being made: one that failed or was cancelled used no Catch up. */
const countsAsCatchUp = (run: WorkflowRun): boolean =>
  run.conclusion === null || run.conclusion === "success";

/** A guard on the request's size (core's PODCAST_MAX_TOPICS), not a product limit. */
const MAX_TOPICS = 50;
export const MAX_TITLE_CHARS = 80;
const LENGTHS: readonly number[] = [3, 5, 10, 15];
/** New requests are a readout or a discussion; a stored episode may still say "headlines". */
const FORMATS: readonly string[] = ["readout", "discussion"];
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS: readonly number[] = [2, 7, 30];
const TONES: readonly string[] = ["neutral", "energetic"];
const AUDIENCES: readonly string[] = ["general", "custom"];
/** A section id: a built-in one or one that came with a topic the owner added. */
const SECTION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** How long to wait for GitHub to list a run it was just asked to start, when dispatch gave no id. */
const RUN_LOOKUP_ATTEMPTS = 3;
const RUN_LOOKUP_DELAY_MS = 1500;

const unavailable: PodcastResult = { status: 503, body: { status: 503, error: "unavailable" } };
const invalid: PodcastResult = { status: 400, body: { status: 400, error: "invalid_request" } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One to MAX_TOPICS distinct section ids, or null. */
function parseTopicIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TOPICS) return null;
  const chosen: string[] = [];
  for (const topic of value) {
    if (typeof topic !== "string" || !SECTION_ID.test(topic) || chosen.includes(topic)) return null;
    chosen.push(topic);
  }
  return chosen;
}

/**
 * The episode request in a body, checked field by field and rebuilt from the checked fields, so
 * nothing else the caller sent reaches the workflow. Null when any field is missing or not allowed.
 * host_names is never taken from the caller: handlePodcast sets it from the voice list.
 */
export function parsePodcastRequest(value: unknown): PodcastRequest | null {
  if (!isRecord(value)) return null;
  const { topic_ids: topics, length_minutes: length, format, window_days: window, tone } = value;
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > MAX_TOPICS) return null;
  const chosen: string[] = [];
  for (const topic of topics) {
    if (typeof topic !== "string" || !SECTION_ID.test(topic) || chosen.includes(topic)) return null;
    chosen.push(topic);
  }
  if (typeof length !== "number" || !LENGTHS.includes(length)) return null;
  if (typeof format !== "string" || !FORMATS.includes(format)) return null;
  if (typeof window !== "number" || !WINDOWS.includes(window)) return null;
  if (typeof tone !== "string" || !TONES.includes(tone)) return null;
  const audience = value.audience;
  if (audience !== undefined && (typeof audience !== "string" || !AUDIENCES.includes(audience))) {
    return null;
  }

  const voices: { voice_id?: string | null; voice_id_b?: string | null } = {};
  for (const key of ["voice_id", "voice_id_b"] as const) {
    const voice = value[key];
    if (voice === undefined) continue;
    if (voice !== null && (typeof voice !== "string" || !VOICE_ID.test(voice))) return null;
    voices[key] = voice;
  }

  let title: string | undefined;
  if (value.title !== undefined) {
    if (typeof value.title !== "string") return null;
    // Control characters never belong in a title that ends up in a file and on a page.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point of this check.
    const cleaned = value.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (cleaned.length > MAX_TITLE_CHARS) return null;
    if (cleaned.length > 0) title = cleaned;
  }

  return {
    topic_ids: chosen,
    length_minutes: length as PodcastRequest["length_minutes"],
    format: format as PodcastRequest["format"],
    window_days: window as PodcastRequest["window_days"],
    tone: tone as PodcastRequest["tone"],
    ...(audience === undefined
      ? {}
      : { audience: audience as NonNullable<PodcastRequest["audience"]> }),
    ...voices,
    ...(title ? { title } : {}),
  };
}

export const MAX_FEEDBACK_CHARS = 500;
const EPISODE_ID = /^ep-\d{8}-\d{4}$/;

/** What the workflow's one input carries for an action on an episode that already exists. */
export type EpisodeAction =
  | { action: "delete"; id: string }
  | { action: "regenerate"; id: string; feedback?: string; topic_ids?: string[] };

/**
 * `resume_from`: the id of an earlier run of this workflow whose finished stages this run reuses
 * (Try again after a failure). It rides beside the request, and the engine takes it out.
 */
export type ParsedPodcastBody = ({ request: PodcastRequest } | EpisodeAction) & {
  resume_from?: string;
};

const RUN_ID = /^[1-9]\d{0,14}$/;

/** The feedback of a regenerate: control characters become spaces, 1 to 500 characters once trimmed. */
export function cleanFeedback(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point of this check.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length >= 1 && cleaned.length <= MAX_FEEDBACK_CHARS ? cleaned : null;
}

/**
 * The episode request out of a JSON body, or null when it is not that shape. A `passphrase` field
 * that a page built before D160 still sends is ignored.
 */
export function parsePodcastBody(bodyText: string): ParsedPodcastBody | null {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  // Absent is none; present, it must be a run id, as a number or a string.
  const given = parsed.resume_from;
  const resume = typeof given === "number" ? String(given) : given;
  if (resume !== undefined && (typeof resume !== "string" || !RUN_ID.test(resume))) return null;
  const resumeField = resume === undefined ? {} : { resume_from: resume };
  const { action } = parsed;
  if (action === undefined) {
    const request = parsePodcastRequest(parsed.request);
    return request ? { request, ...resumeField } : null;
  }
  const { id } = parsed;
  if (typeof id !== "string" || !EPISODE_ID.test(id)) return null;
  if (action === "delete") return { action, id, ...resumeField };
  if (action === "regenerate") {
    // Both are optional: blank comments mean none, and no topics keep the episode's own.
    const blank =
      parsed.feedback === undefined ||
      parsed.feedback === null ||
      (typeof parsed.feedback === "string" && parsed.feedback.trim() === "");
    const feedback = blank ? undefined : cleanFeedback(parsed.feedback);
    if (feedback === null) return null;
    let topicIds: string[] | undefined;
    if (parsed.topic_ids !== undefined) {
      const checked = parseTopicIds(parsed.topic_ids);
      if (checked === null) return null;
      topicIds = checked;
    }
    return {
      action,
      id,
      ...(feedback ? { feedback } : {}),
      ...(topicIds ? { topic_ids: topicIds } : {}),
      ...resumeField,
    };
  }
  return null;
}

export async function handlePodcast(
  input: PodcastInput,
  deps: PodcastDeps,
): Promise<PodcastResult> {
  const config = readServerConfig(deps.env);
  const log = deps.log ?? (() => {});
  if (!config) {
    log(`podcast unavailable: ${missingSettings(deps.env).join(", ")} not set`);
    return unavailable;
  }

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const body = parsePodcastBody(input.bodyText);
  if (body === null) return invalid;
  if ("action" in body && !((await deps.episodeIds?.()) ?? []).includes(body.id)) return invalid;
  // An episode takes three regenerations (D212); the fourth is refused before it costs a run.
  if ("action" in body && body.action === "regenerate") {
    const allowance = await regenerationAllowance(deps, body.id);
    if (allowance === "spent") return regenerationLimit;
    if (allowance === "unknown") {
      log(`podcast unavailable: the regeneration count of ${body.id} could not be read`);
      return unavailable;
    }
  }

  // The shared burst cap (D150), taken only by a request that passed the checks above.
  const burstWait = (await deps.burst?.()) ?? 0;
  if (burstWait > 0) return cooldownRefusal(burstWait);

  // A new discussion's hosts are named after the voices that will read it. The lookup runs beside
  // the GitHub calls, is given up after a short wait and never throws; without names the engine uses
  // its gender-neutral pair, so this can neither fail nor hold up the request.
  const hostNames =
    "request" in body && body.request.format === "discussion"
      ? resolveHostNames(body.request, { env: deps.env, fetch: deps.fetch, log, now: deps.now })
      : undefined;

  const github = createGitHubClient(config, deps.fetch);
  try {
    const runs = await github.listWorkflowFileRuns(PODCAST_WORKFLOW_FILE);
    const times = (list: readonly WorkflowRun[]) =>
      list.map((run) => Date.parse(run.createdAt)).filter(Number.isFinite);
    // A new Catch up is held to the runs that made one; a regeneration or a delete is held to every
    // run of the workflow, as before.
    const made = runs.filter(isNewEpisodeRun);
    let decision = evaluateLimits(
      times("action" in body ? runs : made),
      deps.now(),
      "action" in body
        ? body.action === "delete"
          ? DELETE_POLICY
          : REGENERATE_POLICY
        : PODCAST_POLICY,
    );
    // Two Catch ups a day that came out or are still being made (D213); a failed run is not one.
    if (decision.allowed && !("action" in body)) {
      decision = evaluateLimits(times(made.filter(countsAsCatchUp)), deps.now(), CATCH_UP_POLICY);
    }
    if (!decision.allowed) {
      return {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
        body: {
          status: 429,
          error: decision.reason,
          retry_after_s: decision.retryAfterSeconds,
        },
      };
    }

    const names = await hostNames;
    const startedAt = deps.now();
    const command =
      "request" in body
        ? {
            ...body.request,
            ...(names ? { host_names: names } : {}),
            ...(body.resume_from ? { resume_from: body.resume_from } : {}),
          }
        : body;
    const inputs = { request: JSON.stringify(command) };
    let runId = await github.dispatchWorkflowFile(PODCAST_WORKFLOW_FILE, inputs);
    // Only an id GitHub named for this dispatch gets a token (D242): one picked from the list by
    // its creation time could be another request's run, and its token would stop that one.
    const named = runId !== null;
    for (let attempt = 0; runId === null && attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      // GitHub started the run but did not name it. The newest run created since the request is it.
      await deps.delay(RUN_LOOKUP_DELAY_MS);
      const after = await github.listWorkflowFileRuns(PODCAST_WORKFLOW_FILE);
      runId =
        after.find((run) => Date.parse(run.createdAt) >= startedAt - 5000 && run.status !== "")
          ?.id ?? null;
    }
    if (runId === null) {
      log(
        "podcast unavailable: GitHub accepted the dispatch but the run never appeared in its list",
      );
      return unavailable;
    }

    if ("action" in body && body.action === "delete") {
      // The run is under way; a failed mark only means other devices wait for the sync.
      await deps.tombstone?.(body.id).catch((error) => {
        log(`tombstone failed: ${describeError(error, secretsOf(config))}`);
      });
    }
    return {
      status: 202,
      body: {
        status: 202,
        run_id: runId,
        started_at: new Date(startedAt).toISOString(),
        ...(named ? { cancel_token: cancelTokenFor(config.token, runId) } : {}),
      },
    };
  } catch (error) {
    log(`podcast failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
