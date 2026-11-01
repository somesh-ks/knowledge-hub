import type { Env } from "@singularity/core";
import { noul } from "@typesafe-ai/sdk";
import { z } from "zod";
import { redact } from "../context.js";
import { errorStatus } from "../llm/errors.js";
import { AUDIO_PREFIX } from "../publish/blob.js";
import { type Check, type DoctorDeps, fail, ok, warn } from "./doctorTypes.js";

interface Probe {
  status: number;
  body: unknown;
  headers: Headers;
}

/** One request with a timeout. A network failure throws an Error with a redacted one-line message. */
async function probe(
  deps: DoctorDeps,
  secrets: readonly string[],
  url: string,
  init: RequestInit,
): Promise<Probe> {
  try {
    const response = await deps.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: the status line is what matters.
    }
    return { status: response.status, body, headers: response.headers };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    const reason =
      name === "TimeoutError" || name === "AbortError"
        ? `timed out after ${deps.timeoutMs} ms`
        : redact(error instanceof Error ? error.message : String(error), secrets);
    throw new Error(reason);
  }
}

/** The check for a failed HTTP status: a rejected key fails, a busy service only warns. */
function httpProblem(id: string, service: string, status: number, keyName: string): Check {
  if (status === 401 || status === 403) {
    return fail(
      id,
      `${service} rejected the key (HTTP ${status})`,
      `Rotate ${keyName} and run \`npm run secrets:push\`.`,
    );
  }
  if (status === 429 || status >= 500) {
    return warn(
      id,
      `${service} answered HTTP ${status}`,
      "Usually temporary. Run doctor again later.",
    );
  }
  return fail(
    id,
    `${service} answered HTTP ${status}`,
    "Check the service status page and the key.",
  );
}

function unreachable(id: string, service: string, error: unknown): Check {
  return fail(
    id,
    `${service} is unreachable (${error instanceof Error ? error.message : "request failed"})`,
    "Check the network, then run doctor again.",
  );
}

function skipped(id: string, keyName: string): Check {
  return warn(
    id,
    `skipped, ${keyName} is not set`,
    `Set ${keyName} in .env to check this service.`,
  );
}

/** Lists a provider's models: proves the key and the network, as the run's resolver needs them. */
async function listCheck(
  id: string,
  service: string,
  keyName: "ANTHROPIC_API_KEY" | "GEMINI_API_KEY",
  deps: DoctorDeps,
  env: Env,
  secrets: readonly string[],
): Promise<Check> {
  const key = env[keyName];
  if (key === undefined) return skipped(id, keyName);
  const anthropic = keyName === "ANTHROPIC_API_KEY";
  try {
    const result = await probe(
      deps,
      secrets,
      anthropic
        ? "https://api.anthropic.com/v1/models?limit=1"
        : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      {
        headers: anthropic
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : { "x-goog-api-key": key },
      },
    );
    if (result.status !== 200) return httpProblem(id, service, result.status, keyName);
    return ok(id, "key accepted, models can be listed");
  } catch (error) {
    return unreachable(id, service, error);
  }
}

async function jevCheck(env: Env, deps: DoctorDeps, secrets: readonly string[]): Promise<Check> {
  if (env.TYPESAFE_API_KEY === undefined) return skipped("online.jev", "TYPESAFE_API_KEY");
  try {
    await deps.createJev(env).systemOne({
      state: { text: "Singularity doctor check" },
      questions: {
        ready: noul("The `text` is a short test message.", {
          true: "It is a short test message.",
          false: "It is not a test message.",
        }),
      },
    });
    return ok("online.jev", "answered a trivial question");
  } catch (error) {
    const status = errorStatus(error);
    if (status !== undefined) return httpProblem("online.jev", "Jev", status, "TYPESAFE_API_KEY");
    return unreachable(
      "online.jev",
      "Jev",
      new Error(redact(error instanceof Error ? error.message : String(error), secrets)),
    );
  }
}

async function exaCheck(env: Env, deps: DoctorDeps, secrets: readonly string[]): Promise<Check> {
  const key = env.EXA_API_KEY;
  if (key === undefined) return skipped("online.exa", "EXA_API_KEY");
  try {
    // Exa has no free account endpoint for ordinary keys, so one single-result search is the check.
    const result = await probe(deps, secrets, "https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: "design engineering", numResults: 1 }),
    });
    return result.status === 200
      ? ok("online.exa", "answered one search (about 0.007 USD)")
      : httpProblem("online.exa", "Exa", result.status, "EXA_API_KEY");
  } catch (error) {
    return unreachable("online.exa", "Exa", error);
  }
}

const FirecrawlCredits = z.object({
  data: z.object({ remainingCredits: z.number().optional() }).loose().optional(),
});

async function firecrawlCheck(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check> {
  const key = env.FIRECRAWL_API_KEY;
  if (key === undefined) return skipped("online.firecrawl", "FIRECRAWL_API_KEY");
  try {
    const result = await probe(deps, secrets, "https://api.firecrawl.dev/v2/team/credit-usage", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (result.status !== 200)
      return httpProblem("online.firecrawl", "Firecrawl", result.status, "FIRECRAWL_API_KEY");
    const credits = FirecrawlCredits.safeParse(result.body);
    const remaining = credits.success ? credits.data.data?.remainingCredits : undefined;
    if (remaining !== undefined && remaining < 50) {
      return warn(
        "online.firecrawl",
        `${remaining} credits left`,
        "Top up or wait for the plan to renew.",
      );
    }
    return ok(
      "online.firecrawl",
      remaining === undefined ? "key accepted" : `${remaining} credits left`,
    );
  } catch (error) {
    return unreachable("online.firecrawl", "Firecrawl", error);
  }
}

/** The voices list is an array, or an object holding one under `voices` or `data`. */
function voiceIds(body: unknown): string[] {
  const list: unknown = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null
      ? ((body as { voices?: unknown }).voices ?? (body as { data?: unknown }).data)
      : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((voice) => {
    const id = (voice as { id?: unknown } | null)?.id;
    return typeof id === "string" ? [id] : [];
  });
}

const MAX_VOICE_PAGES = 20;

/** The cursor for the next page, or undefined on the last one. */
function nextVoiceCursor(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { has_more: hasMore, next_cursor: next } = body as {
    has_more?: unknown;
    next_cursor?: unknown;
  };
  return hasMore === true && typeof next === "string" && next !== "" ? next : undefined;
}

async function speechifyCheck(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check> {
  const key = env.SPEECHIFY_API_KEY;
  if (key === undefined) return skipped("online.speechify", "SPEECHIFY_API_KEY");
  try {
    // The catalogue is paged (50 by default), so follow the cursor or a valid voice looks missing.
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_VOICE_PAGES; page++) {
      const query = new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : {}) });
      const result = await probe(deps, secrets, `https://api.speechify.ai/v1/voices?${query}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      if (result.status !== 200)
        return httpProblem("online.speechify", "Speechify", result.status, "SPEECHIFY_API_KEY");
      ids.push(...voiceIds(result.body));
      cursor = nextVoiceCursor(result.body);
      if (cursor === undefined) break;
    }
    if (ids.length === 0) {
      return warn(
        "online.speechify",
        "key accepted but the voice list was empty or unreadable",
        "Check the Speechify API response shape.",
      );
    }
    return ids.includes(env.SPEECHIFY_VOICE_ID)
      ? ok("online.speechify", `key accepted, voice ${env.SPEECHIFY_VOICE_ID} exists`)
      : fail(
          "online.speechify",
          `voice ${env.SPEECHIFY_VOICE_ID} is not in your voice list`,
          `Set SPEECHIFY_VOICE_ID to one of: ${ids.slice(0, 5).join(", ")}.`,
        );
  } catch (error) {
    return unreachable("online.speechify", "Speechify", error);
  }
}

async function blobCheck(env: Env, deps: DoctorDeps, secrets: readonly string[]): Promise<Check> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token === undefined) return skipped("online.blob", "BLOB_READ_WRITE_TOKEN");
  try {
    const page = await deps.createBlob(token).list({ prefix: AUDIO_PREFIX });
    return ok(
      "online.blob",
      `token accepted, ${page.blobs.length}${page.hasMore ? "+" : ""} narrations stored`,
    );
  } catch (error) {
    const status = errorStatus(error);
    if (status !== undefined)
      return httpProblem("online.blob", "Vercel Blob", status, "BLOB_READ_WRITE_TOKEN");
    const message = redact(error instanceof Error ? error.message : String(error), secrets);
    return /unauthor|forbidden|invalid.*token|token/i.test(message)
      ? fail(
          "online.blob",
          "Vercel Blob rejected the token",
          "Copy a fresh BLOB_READ_WRITE_TOKEN from the Blob store and run `npm run secrets:push`.",
        )
      : unreachable("online.blob", "Vercel Blob", new Error(message.split("\n")[0]));
  }
}

/** The audio workflow runs `vercel link` with this token; a rejected one fails with "User not found". */
async function vercelTokenCheck(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check> {
  const token = env.VERCEL_TOKEN;
  if (token === undefined) return skipped("online.vercel", "VERCEL_TOKEN");
  try {
    const result = await probe(deps, secrets, "https://api.vercel.com/v2/user", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (result.status === 200) return ok("online.vercel", "token accepted");
    if (result.status === 401 || result.status === 403 || result.status === 404) {
      return fail(
        "online.vercel",
        `Vercel rejected the token (HTTP ${result.status})`,
        "Create an account token in the Vercel dashboard (Settings, Tokens), put it in .env as VERCEL_TOKEN and run `npm run secrets:push`.",
      );
    }
    return httpProblem("online.vercel", "Vercel", result.status, "VERCEL_TOKEN");
  } catch (error) {
    return unreachable("online.vercel", "Vercel", error);
  }
}

const DAY_MS = 86_400_000;
const TOKEN_EXPIRY_WARNING_DAYS = 14;

/**
 * The token the site dispatches workflows and writes RUN_CRON with. A rejected or expired one made a
 * settings save a silent no-op (SEC-06, 2026-10-14 unchecked): the site only logs a refusal. This
 * proves the token still opens the repository and reads Actions variables, and reads its expiry from
 * GitHub's header. It cannot test "Variables: write" without writing, so a missing write permission
 * still shows only when a save changes the schedule.
 */
async function githubTokenCheck(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check> {
  const id = "online.github";
  const token = env.GITHUB_SINGULARITY_TOKEN ?? env.GITHUB_DISPATCH_TOKEN;
  if (token === undefined) return skipped(id, "GITHUB_SINGULARITY_TOKEN");
  const repo = env.GITHUB_REPOSITORY ?? "somesh-ks/knowledge-hub";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "singularity-doctor",
  };
  try {
    const repository = await probe(deps, secrets, `https://api.github.com/repos/${repo}`, {
      headers,
    });
    if (repository.status === 401) {
      return fail(
        id,
        "GitHub rejected the token (expired or revoked)",
        "Create a fine-grained token for the repository with Actions and Variables write, put it in .env as GITHUB_SINGULARITY_TOKEN and run `npm run secrets:push`.",
      );
    }
    // A spent rate limit also answers 403: the token is fine, the check just cannot say so.
    if (
      repository.status === 403 &&
      (repository.headers.get("x-ratelimit-remaining") === "0" ||
        repository.headers.has("retry-after"))
    ) {
      return warn(
        id,
        `GitHub rate limited the check for ${repo} (HTTP 403); the token was not tested`,
        "Wait for the rate limit to reset, then run doctor again.",
      );
    }
    if (repository.status === 403 || repository.status === 404) {
      return fail(
        id,
        `GitHub cannot show ${repo} to the token (HTTP ${repository.status})`,
        "The token does not cover this repository. Create one that does and run `npm run secrets:push`.",
      );
    }
    if (repository.status !== 200)
      return httpProblem(id, "GitHub", repository.status, "GITHUB_SINGULARITY_TOKEN");
    const variables = await probe(
      deps,
      secrets,
      `https://api.github.com/repos/${repo}/actions/variables`,
      { headers },
    );
    // The list, not RUN_CRON by name: GitHub answers 404 to a token without the permission, which a
    // missing variable would also look like. An empty list is still a read that was allowed.
    if (variables.status !== 200) {
      return warn(
        id,
        `the token opens ${repo} but cannot read Actions variables (HTTP ${variables.status})`,
        "Give it the Variables permission (write), or a schedule change saves but the fallback cron goes stale.",
      );
    }
    const expires = Date.parse(
      (repository.headers.get("github-authentication-token-expiration") ?? "").replace(" UTC", "Z"),
    );
    if (Number.isFinite(expires)) {
      const days = Math.floor((expires - Date.now()) / DAY_MS);
      if (days < TOKEN_EXPIRY_WARNING_DAYS) {
        return warn(
          id,
          days < 0 ? "the token has expired" : `the token expires in ${days} days`,
          "Create a new fine-grained token and run `npm run secrets:push`; after it expires every save from the site is dropped.",
        );
      }
      return ok(
        id,
        `token accepted, expires in ${days} days; Variables read works, write untested`,
      );
    }
    return ok(id, "token accepted, no expiry; Variables read works, write untested");
  } catch (error) {
    return unreachable(id, "GitHub", error);
  }
}

/** Lightweight authenticated checks. Each one is skipped, with a warning, when its key is unset. */
export async function onlineChecks(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check[]> {
  const [anthropic, gemini, jev, exa, firecrawl, speechify, blob, vercel, github] =
    await Promise.all([
      listCheck("online.anthropic", "Anthropic", "ANTHROPIC_API_KEY", deps, env, secrets),
      listCheck("online.gemini", "Gemini", "GEMINI_API_KEY", deps, env, secrets),
      jevCheck(env, deps, secrets),
      exaCheck(env, deps, secrets),
      firecrawlCheck(env, deps, secrets),
      speechifyCheck(env, deps, secrets),
      blobCheck(env, deps, secrets),
      vercelTokenCheck(env, deps, secrets),
      githubTokenCheck(env, deps, secrets),
    ]);
  return [anthropic, gemini, jev, exa, firecrawl, speechify, blob, vercel, github];
}
