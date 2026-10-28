import type { GenerateResponse } from "../types/contracts";
import { missingSettings, readServerConfig, type ServerEnv, secretsOf } from "./config";
import { createGitHubClient, type FetchLike } from "./github";
import type { ApiResult } from "./http";
import { DELETE_POLICY, evaluateLimits } from "./limits";
import { cleanFeedback } from "./podcast";
import { cooldownRefusal } from "./rateLimit";
import { describeError } from "./redact";

/**
 * POST /api/generate: check the request, check the rate limits against GitHub, singularity run.yml.
 * Everything with a side effect is a parameter (fetch, clock, delay, the logger), so the whole flow
 * is tested with fakes and no network. There is no passphrase (D160).
 */

export const MAX_BODY_CHARS = 2048;
/** How long to wait for GitHub to list a run it was just asked to start, when dispatch gave no id. */
const RUN_LOOKUP_ATTEMPTS = 3;
const RUN_LOOKUP_DELAY_MS = 1500;

export interface GenerateDeps {
  /** The shared per-minute burst cap (D150): 0 to go ahead, else the seconds to wait. */
  burst?: () => Promise<number>;
  env: ServerEnv;
  fetch: FetchLike;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  /** The digests this build knows; Regenerate and Delete on a briefing refuse any other id. */
  digestIds?: () => readonly string[] | Promise<readonly string[]>;
  /** A digest's kind ("regular", "weekly", "on-demand"); Delete refuses the scheduled ones. */
  digestKind?: (id: string) => Promise<string | null>;
  log?: (message: string) => void;
}

export interface GenerateInput {
  bodyText: string;
  /** The request's Origin header, if the browser sent one. */
  origin: string | null;
  /** The origin the request was made to. */
  expectedOrigin: string;
}

type GenerateResult = ApiResult<GenerateResponse>;

const unavailable: GenerateResult = {
  status: 503,
  body: { status: 503, error: "unavailable" },
};
const invalid: GenerateResult = { status: 400, body: { status: 400, error: "invalid_request" } };

/**
 * Whether the body is one JSON object of a size the route reads. A `passphrase` field that a page
 * built before D160 still sends is ignored with any other field the route does not read.
 */
export function isJsonObjectBody(bodyText: string): boolean {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return false;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * The optional note on what to improve, as the podcast regenerate cleans it: control characters
 * become spaces, 1 to 500 characters. Absent or blank means none; any other type or a longer note
 * is invalid (undefined), so a request is refused before it costs a run.
 */
export function parseFeedback(bodyText: string): string | null | undefined {
  const raw = (JSON.parse(bodyText) as { feedback?: unknown }).feedback;
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  return cleanFeedback(raw) ?? undefined;
}

/** A topic id, as a section id or a topic's own id. */
const TOPIC_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The topics chosen for this one regeneration: absent means the run's own, otherwise one to 50
 * distinct ids. Anything else is invalid (undefined), so a request is refused before it costs a run.
 */
export function parseTopics(bodyText: string): string[] | null | undefined {
  const raw = (JSON.parse(bodyText) as { topics?: unknown }).topics;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) return undefined;
  const chosen: string[] = [];
  for (const topic of raw) {
    if (typeof topic !== "string" || !TOPIC_ID.test(topic) || chosen.includes(topic)) {
      return undefined;
    }
    chosen.push(topic);
  }
  return chosen;
}

/** The lengths a person can ask a run for, the schedule's own choices (core's ScheduleLengthMinutes). */
const LENGTHS: readonly number[] = [3, 5, 10, 15];

/**
 * The minutes this one run is asked to be, in place of the schedule's: absent means the schedule's,
 * otherwise one of its four lengths. Anything else is invalid (undefined), so a request is refused
 * before it costs a run.
 */
export function parseLength(bodyText: string): number | null | undefined {
  const raw = (JSON.parse(bodyText) as { length_minutes?: unknown }).length_minutes;
  if (raw === undefined || raw === null) return null;
  return typeof raw === "number" && LENGTHS.includes(raw) ? raw : undefined;
}

/** A digest id: a date, then `-weekly` or a same-day number (core's DigestId). */
const DIGEST_ID = /^\d{4}-\d{2}-\d{2}(-weekly|-[2-9]|-[1-9]\d+)?$/;

/** What the request does to a briefing that exists; invalid is undefined, absent is a new one. */
export type BriefingTarget = { delete: string } | { replace: string } | null | undefined;

export function parseTarget(bodyText: string): BriefingTarget {
  const { action, id, replace } = JSON.parse(bodyText) as Record<string, unknown>;
  if (action !== undefined) {
    return action === "delete" && typeof id === "string" && DIGEST_ID.test(id)
      ? { delete: id }
      : undefined;
  }
  if (replace === undefined || replace === null) return null;
  return typeof replace === "string" && DIGEST_ID.test(replace) ? { replace } : undefined;
}

/** A browser that names another site as the origin is a cross-site request, which is never ours. */
export function isSameOrigin(origin: string | null, expectedOrigin: string): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

export async function handleGenerate(
  input: GenerateInput,
  deps: GenerateDeps,
): Promise<GenerateResult> {
  const config = readServerConfig(deps.env);
  const log = deps.log ?? (() => {});
  if (!config) {
    log(`generate unavailable: ${missingSettings(deps.env).join(", ")} not set`);
    return unavailable;
  }

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  if (!isJsonObjectBody(input.bodyText)) return invalid;
  const feedback = parseFeedback(input.bodyText);
  if (feedback === undefined) return invalid;
  const topics = parseTopics(input.bodyText);
  if (topics === undefined) return invalid;
  const length = parseLength(input.bodyText);
  if (length === undefined) return invalid;
  const target = parseTarget(input.bodyText);
  if (target === undefined) return invalid;
  const id = target === null ? null : "delete" in target ? target.delete : target.replace;
  if (id !== null && !((await deps.digestIds?.()) ?? []).includes(id)) return invalid;
  // A delete carries no feedback, and feedback never reaches a run that deletes.
  const deleting = target !== null && "delete" in target;
  // Only an on-demand briefing can be deleted: the Daily and the Weekly are the schedule's record.
  if (deleting && id !== null) {
    const kind = await deps.digestKind?.(id);
    if (kind === "regular" || kind === "weekly") return invalid;
  }

  // The shared burst cap (D150), taken only by a request that passed the checks above.
  const burstWait = (await deps.burst?.()) ?? 0;
  if (burstWait > 0) return cooldownRefusal(burstWait);

  const github = createGitHubClient(config, deps.fetch);
  try {
    const runs = await github.listDispatchRuns();
    // A delete is a run of run.yml too, but it must not use up the cooldown of a Regenerate.
    const started = runs
      .filter((run) => deleting || !run.title.startsWith("delete "))
      .map((run) => Date.parse(run.createdAt))
      .filter(Number.isFinite);
    const decision = evaluateLimits(started, deps.now(), deleting ? DELETE_POLICY : undefined);
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
    let runId = await github.dispatch(
      deleting
        ? { delete: id ?? "" }
        : {
            mode: "on-demand",
            ...(feedback ? { feedback } : {}),
            ...(topics && id ? { topics: topics.join(",") } : {}),
            ...(length ? { length_minutes: String(length) } : {}),
            ...(id ? { replace: id } : {}),
          },
    );
    for (let attempt = 0; runId === null && attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      // GitHub started the run but did not name it. The newest singularity run created since the
      // request is the one.
      await deps.delay(RUN_LOOKUP_DELAY_MS);
      const after = await github.listDispatchRuns();
      runId =
        after.find((run) => Date.parse(run.createdAt) >= startedAt - 5000 && run.status !== "")
          ?.id ?? null;
    }
    if (runId === null) {
      log(
        "generate unavailable: GitHub accepted the dispatch but the run never appeared in its list",
      );
      return unavailable;
    }

    return {
      status: 202,
      body: { status: 202, run_id: runId, started_at: new Date(startedAt).toISOString() },
    };
  } catch (error) {
    log(`generate failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
