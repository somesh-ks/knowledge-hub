import type { GenerateResponse } from "../types/contracts";
import { readServerConfig, type ServerEnv, secretsOf } from "./config";
import { createGitHubClient, type FetchLike } from "./github";
import type { ApiResult } from "./http";
import { DELETE_POLICY, evaluateLimits } from "./limits";
import { cleanFeedback } from "./podcast";
import { describeError } from "./redact";

/**
 * POST /api/generate: check the passphrase, check the rate limits against GitHub, dispatch run.yml.
 * Everything with a side effect is a parameter (fetch, clock, delay, the verifier, the logger), so the
 * whole flow is tested with fakes and no network.
 */

/** A wrong guess costs the caller this much extra time, on top of the scrypt work. */
export const WRONG_PASSPHRASE_DELAY_MS = 750;
export const MAX_BODY_CHARS = 2048;
export const MAX_PASSPHRASE_CHARS = 256;
/** How long to wait for GitHub to list a run it was just asked to start, when dispatch gave no id. */
const RUN_LOOKUP_ATTEMPTS = 3;
const RUN_LOOKUP_DELAY_MS = 1500;

export interface GenerateDeps {
  env: ServerEnv;
  fetch: FetchLike;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
  verifyPassphrase: (passphrase: string, storedHash: string) => Promise<boolean>;
  /** The digests this build knows; Regenerate and Delete on a briefing refuse any other id. */
  digestIds?: () => readonly string[];
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

/** Pulls the passphrase out of a JSON body, or null when the body is not the expected shape. */
export function parsePassphrase(bodyText: string): string | null {
  if (bodyText.length === 0 || bodyText.length > MAX_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const passphrase = (parsed as { passphrase?: unknown }).passphrase;
  if (typeof passphrase !== "string") return null;
  if (passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_CHARS) return null;
  return passphrase;
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
  if (!config) return unavailable;

  if (!isSameOrigin(input.origin, input.expectedOrigin)) return invalid;
  const passphrase = parsePassphrase(input.bodyText);
  if (passphrase === null) return invalid;
  // parsePassphrase has already proven the body is a JSON object.
  const feedback = parseFeedback(input.bodyText);
  if (feedback === undefined) return invalid;
  const target = parseTarget(input.bodyText);
  if (target === undefined) return invalid;
  const id = target === null ? null : "delete" in target ? target.delete : target.replace;
  if (id !== null && !(deps.digestIds?.() ?? []).includes(id)) return invalid;
  // A delete carries no feedback, and feedback never reaches a run that deletes.
  const deleting = target !== null && "delete" in target;

  const isValid = await deps.verifyPassphrase(passphrase, config.passphraseHash);
  if (!isValid) {
    await deps.delay(WRONG_PASSPHRASE_DELAY_MS);
    return { status: 401, body: { status: 401, error: "wrong_passphrase" } };
  }

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
            ...(id ? { replace: id } : {}),
          },
    );
    for (let attempt = 0; runId === null && attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      // GitHub started the run but did not name it. The newest dispatch run created since the
      // request is the one.
      await deps.delay(RUN_LOOKUP_DELAY_MS);
      const after = await github.listDispatchRuns();
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
    log(`generate failed: ${describeError(error, secretsOf(config))}`);
    return unavailable;
  }
}
