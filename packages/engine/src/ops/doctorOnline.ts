import type { Env } from "@dispatch/core";
import { noul } from "@typesafe-ai/sdk";
import { z } from "zod";
import { redact } from "../context.js";
import { errorStatus } from "../llm/errors.js";
import { AUDIO_PREFIX } from "../publish/blob.js";
import { type Check, type DoctorDeps, fail, ok, warn } from "./doctorTypes.js";

interface Probe {
  status: number;
  body: unknown;
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
    return { status: response.status, body };
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

const NebiusModels = z.object({ data: z.array(z.object({ id: z.string() }).loose()) });

/** Ids that share the start of `wanted`'s family, to suggest a replacement for a retired id. */
export function similarModels(wanted: string, ids: readonly string[]): string[] {
  const family = (wanted.split("/").pop() ?? wanted).toLowerCase().split(/[-_.]/)[0] ?? "";
  if (family.length < 3) return [];
  return ids.filter((id) => id.toLowerCase().includes(family)).slice(0, 4);
}

function joinUrl(base: string, path: string): string {
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

async function nebiusChecks(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check[]> {
  const key = env.NEBIUS_API_KEY;
  if (key === undefined) {
    return [skipped("online.nebius", "NEBIUS_API_KEY")];
  }
  let result: Probe;
  try {
    result = await probe(deps, secrets, joinUrl(env.NEBIUS_BASE_URL, "models"), {
      headers: { authorization: `Bearer ${key}` },
    });
  } catch (error) {
    return [unreachable("online.nebius", "Nebius", error)];
  }
  if (result.status !== 200) {
    return [httpProblem("online.nebius", "Nebius", result.status, "NEBIUS_API_KEY")];
  }
  const parsed = NebiusModels.safeParse(result.body);
  if (!parsed.success) {
    return [
      fail(
        "online.nebius",
        "Nebius answered an unexpected shape from /models",
        "Check NEBIUS_BASE_URL.",
      ),
    ];
  }
  const ids = parsed.data.data.map((model) => model.id);
  const checks: Check[] = [ok("online.nebius", `key accepted, ${ids.length} models listed`)];
  // Nebius retires ids (Qwen3-32B left the serverless tier on 2026-08-31), so each id is checked.
  for (const name of ["DISPATCH_MODEL", "DISPATCH_FALLBACK_MODEL"] as const) {
    const wanted = env[name];
    const id = `online.model.${name}`;
    if (wanted === undefined) {
      checks.push(warn(id, "skipped, not set", `Set ${name} in .env, then run doctor again.`));
    } else if (ids.includes(wanted)) {
      checks.push(ok(id, `${wanted} is listed`));
    } else {
      const near = similarModels(wanted, ids);
      checks.push(
        fail(
          id,
          `${wanted} is not in the live model list`,
          `Run \`dispatch models\` and update ${name} in .env${near.length > 0 ? `; similar: ${near.join(", ")}` : ""}.`,
        ),
      );
    }
  }
  return checks;
}

async function jevCheck(env: Env, deps: DoctorDeps, secrets: readonly string[]): Promise<Check> {
  if (env.TYPESAFE_API_KEY === undefined) return skipped("online.jev", "TYPESAFE_API_KEY");
  try {
    await deps.createJev(env).systemOne({
      state: { text: "Dispatch doctor check" },
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

async function speechifyCheck(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check> {
  const key = env.SPEECHIFY_API_KEY;
  if (key === undefined) return skipped("online.speechify", "SPEECHIFY_API_KEY");
  try {
    const result = await probe(deps, secrets, "https://api.speechify.ai/v1/voices", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (result.status !== 200)
      return httpProblem("online.speechify", "Speechify", result.status, "SPEECHIFY_API_KEY");
    const ids = voiceIds(result.body);
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

/** Lightweight authenticated checks. Each one is skipped, with a warning, when its key is unset. */
export async function onlineChecks(
  env: Env,
  deps: DoctorDeps,
  secrets: readonly string[],
): Promise<Check[]> {
  const [nebius, jev, exa, firecrawl, speechify, blob] = await Promise.all([
    nebiusChecks(env, deps, secrets),
    jevCheck(env, deps, secrets),
    exaCheck(env, deps, secrets),
    firecrawlCheck(env, deps, secrets),
    speechifyCheck(env, deps, secrets),
    blobCheck(env, deps, secrets),
  ]);
  return [...nebius, jev, exa, firecrawl, speechify, blob];
}
