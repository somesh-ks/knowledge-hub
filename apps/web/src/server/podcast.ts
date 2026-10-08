import type { PodcastCreateResponse, PodcastRequest } from "../types/contracts";
import { readServerConfig, secretsOf } from "./config";
import {
  type GenerateDeps,
  type GenerateInput,
  isSameOrigin,
  MAX_BODY_CHARS,
  MAX_PASSPHRASE_CHARS,
  WRONG_PASSPHRASE_DELAY_MS,
} from "./generate";
import { createGitHubClient, PODCAST_WORKFLOW_FILE } from "./github";
import type { ApiResult } from "./http";
import { DELETE_POLICY, evaluateLimits, PODCAST_POLICY } from "./limits";
import { describeError } from "./redact";

/**
 * POST /api/podcast: check the request and the passphrase, check the episode limits against
 * GitHub, dispatch podcast.yml with the request as its one input. Built like /api/generate and with
 * the same guards, and tested the same way: every side effect is a parameter.
 */

/** `episodeIds` lists the episodes this build knows; delete and regenerate refuse any other id. */
export type PodcastDeps = GenerateDeps & { episodeIds?: () => readonly string[] };
export type PodcastInput = GenerateInput;
type PodcastResult = ApiResult<PodcastCreateResponse>;

export const MAX_TOPICS = 6;
export const MAX_TITLE_CHARS = 80;
const LENGTHS: readonly number[] = [3, 5, 10, 15];
const FORMATS: readonly string[] = ["readout", "discussion", "headlines"];
const WINDOWS: readonly number[] = [2, 7, 30];
const TONES: readonly string[] = ["neutral", "energetic", "dry"];
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

/**
 * The episode request in a body, checked field by field and rebuilt from the checked fields, so
 * nothing else the caller sent reaches the workflow. Null when any field is missing or not allowed.
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
    ...(title ? { title } : {}),
  };
}

export const MAX_FEEDBACK_CHARS = 500;
const EPISODE_ID = /^ep-\d{8}-\d{4}$/;

/** What the workflow's one input carries for an action on an episode that already exists. */
export type EpisodeAction =
  | { action: "delete"; id: string }
  | { action: "regenerate"; id: string; feedback: string };

export type ParsedPodcastBody =
  | { passphrase: string; request: PodcastRequest }
  | ({ passphrase: string } & EpisodeAction);

/** The feedback of a regenerate: control characters become spaces, 1 to 500 characters once trimmed. */
function cleanFeedback(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point of this check.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length >= 1 && cleaned.length <= MAX_FEEDBACK_CHARS ? cleaned : null;
}

/** The passphrase and the episode request out of a JSON body, or null when it is not that shape. */
export function parsePodcastBody(bodyText: string): ParsedPodcastBody | null {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { passphrase } = parsed;
  if (typeof passphrase !== "string") return null;
  if (passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_CHARS) return null;
  const { action } = parsed;
  if (action === undefined) {
    const request = parsePodcastRequest(parsed.request);
    return request ? { passphrase, request } : null;
  }
  const { id } = parsed;
  if (typeof id !== "string" || !EPISODE_ID.test(id)) return null;
  if (action === "delete") return { passphrase, action, id };
  if (action === "regenerate") {
    const feedback = cleanFeedback(parsed.feedback);
    return feedback === null ? null : { passphrase, action, id, feedback };
  }
  return null;
}

export async function handlePodcast(
  input: PodcastInput,
  deps: PodcastDeps,
): Promise<PodcastResult> {
  const config = readServerConfig(deps.env);
  const log = deps.log ?? (() => {});
  if (!config) return unavailable;

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const body = parsePodcastBody(input.bodyText);
  if (body === null) return invalid;
  if ("action" in body && !(deps.episodeIds?.() ?? []).includes(body.id)) return invalid;

  const isValid = await deps.verifyPassphrase(body.passphrase, config.passphraseHash);
  if (!isValid) {
    await deps.delay(WRONG_PASSPHRASE_DELAY_MS);
    return { status: 401, body: { status: 401, error: "wrong_passphrase" } };
  }

  const github = createGitHubClient(config, deps.fetch);
  try {
    const runs = await github.listWorkflowFileRuns(PODCAST_WORKFLOW_FILE);
    const started = runs.map((run) => Date.parse(run.createdAt)).filter(Number.isFinite);
    const decision = evaluateLimits(
      started,
      deps.now(),
      "action" in body && body.action === "delete" ? DELETE_POLICY : PODCAST_POLICY,
    );
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

    const startedAt = deps.now();
    const { passphrase: _passphrase, ...rest } = body;
    const inputs = { request: JSON.stringify("request" in rest ? rest.request : rest) };
    let runId = await github.dispatchWorkflowFile(PODCAST_WORKFLOW_FILE, inputs);
    for (let attempt = 0; runId === null && attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      // GitHub started the run but did not name it. The newest run created since the request is it.
      await deps.delay(RUN_LOOKUP_DELAY_MS);
      const after = await github.listWorkflowFileRuns(PODCAST_WORKFLOW_FILE);
      runId =
        after.find((run) => Date.parse(run.createdAt) >= startedAt - 5000 && run.status !== "")
          ?.id ?? null;
    }
    if (runId === null) return unavailable;

    return {
      status: 202,
      body: { status: 202, run_id: runId, started_at: new Date(startedAt).toISOString() },
    };
  } catch (error) {
    log(`podcast failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
