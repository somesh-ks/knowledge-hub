import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, Preferences, STATE_FILES } from "@dispatch/core";
import { noul } from "@typesafe-ai/sdk";
import { z } from "zod";
import type { CommandContext } from "../context.js";
import { redact } from "../context.js";
import { loadQueries } from "../fetch/queries.js";
import type { GitRunner } from "../git/runGit.js";
import type { JevClientLike } from "../judge/jev.js";
import { errorStatus } from "../llm/errors.js";
import type { BlobClient } from "../publish/blob.js";
import { AUDIO_PREFIX } from "../publish/blob.js";
import { parseSources } from "../sources/registry.js";
import { parseVoice } from "../voice/voice.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  id: string;
  status: CheckStatus;
  summary: string;
  /** What to do about a warn or fail. */
  hint?: string;
}

export interface DoctorReport {
  version: 1;
  online: boolean;
  /** False when any check failed. Warnings do not fail the run. */
  ok: boolean;
  totals: { ok: number; warn: number; fail: number };
  checks: Check[];
}

/** Everything doctor touches outside the repository files, injectable for tests. */
export interface DoctorDeps {
  fetchImpl: typeof fetch;
  nodeVersion: string;
  git: GitRunner;
  createJev: (env: Env) => JevClientLike;
  createBlob: (token: string) => BlobClient;
  /** Per-request timeout for online checks. */
  timeoutMs: number;
}

export const MIN_NODE_MAJOR = 24;

const ok = (id: string, summary: string): Check => ({ id, status: "ok", summary });
const warn = (id: string, summary: string, hint: string): Check => ({
  id,
  status: "warn",
  summary,
  hint,
});
const fail = (id: string, summary: string, hint: string): Check => ({
  id,
  status: "fail",
  summary,
  hint,
});

async function readFileIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function firstIssue(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`;
  }
  return error instanceof Error ? (error.message.split("\n")[0] ?? "invalid") : "invalid";
}

// --- offline ----------------------------------------------------------------

function nodeCheck(version: string): Check {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return major >= MIN_NODE_MAJOR
    ? ok("node", `Node ${version}`)
    : fail(
        "node",
        `Node ${version} is older than ${MIN_NODE_MAJOR}`,
        "Install Node 24 or newer; .nvmrc pins the version.",
      );
}

async function gitChecks(root: string, git: GitRunner): Promise<Check[]> {
  const checks: Check[] = [];
  let version: Awaited<ReturnType<GitRunner>>;
  try {
    version = await git(["--version"]);
  } catch {
    return [fail("git", "git is not installed or not on PATH", "Install git.")];
  }
  if (version.code !== 0) return [fail("git", "git did not run", "Reinstall git.")];
  checks.push(ok("git", version.stdout.trim()));

  const inside = await git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    checks.push(
      fail(
        "repo",
        `${root} is not a git working tree`,
        "Run from the repository or pass --root <path>.",
      ),
    );
    return checks;
  }
  checks.push(ok("repo", root));

  const remote = await git(["remote", "get-url", "origin"]);
  checks.push(
    remote.code === 0
      ? ok("remote", "origin is configured")
      : warn(
          "remote",
          "no origin remote",
          "Pushes will fail until you add one: git remote add origin <url>.",
        ),
  );
  const status = await git(["status", "--porcelain"]);
  if (status.code === 0 && status.stdout.trim() !== "") {
    const count = status.stdout.trim().split("\n").length;
    checks.push(
      warn(
        "tree",
        `${count} uncommitted change${count === 1 ? "" : "s"}`,
        "Local runs and `learn --commit` refuse a dirty tree. Commit or stash first.",
      ),
    );
  } else {
    checks.push(ok("tree", "working tree is clean"));
  }
  return checks;
}

async function configChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];

  const prefs = await readFileIfPresent(join(root, "config/preferences.json"));
  if (prefs === null) {
    checks.push(
      fail("config.preferences", "config/preferences.json is missing", "Restore it from git."),
    );
  } else {
    try {
      Preferences.parse(JSON.parse(prefs));
      checks.push(ok("config.preferences", "valid"));
    } catch (error) {
      checks.push(
        fail(
          "config.preferences",
          `invalid (${firstIssue(error)})`,
          "Fix the file or restore it from git.",
        ),
      );
    }
  }

  const sources = await readFileIfPresent(join(root, "config/sources.json"));
  if (sources === null) {
    checks.push(
      fail("config.sources", "config/sources.json is missing", "Run `dispatch sources import`."),
    );
  } else {
    try {
      const file = parseSources(JSON.parse(sources));
      const enabled = file.sources.filter((source) => source.enabled).length;
      checks.push(ok("config.sources", `${file.sources.length} sources, ${enabled} enabled`));
    } catch (error) {
      checks.push(
        fail(
          "config.sources",
          `invalid (${firstIssue(error)})`,
          "Run `dispatch sources import` to rebuild it from config/sources.md.",
        ),
      );
    }
  }

  try {
    const queries = await loadQueries(root);
    checks.push(
      queries.queries.length > 0
        ? ok("config.queries", `${queries.queries.length} Exa queries`)
        : warn(
            "config.queries",
            "no Exa queries",
            "Semantic discovery finds nothing without config/queries.json.",
          ),
    );
  } catch (error) {
    checks.push(
      fail("config.queries", `invalid (${firstIssue(error)})`, "Fix config/queries.json."),
    );
  }

  const voice = await readFileIfPresent(join(root, "config/voice.md"));
  if (voice === null) {
    checks.push(fail("config.voice", "config/voice.md is missing", "Restore it from git."));
  } else {
    try {
      const parsed = parseVoice(voice);
      checks.push(
        ok(
          "config.voice",
          `${parsed.bannedWords.length} banned words, ${parsed.bannedPatterns.length} patterns`,
        ),
      );
    } catch (error) {
      checks.push(fail("config.voice", firstIssue(error), "Fix config/voice.md."));
    }
  }
  return checks;
}

const STATE_SCHEMAS = [
  ["seen", z.object({ version: z.literal(1), items: z.record(z.string(), z.string()) })],
  ["judgments", z.object({ version: z.literal(1), entries: z.record(z.string(), z.unknown()) })],
  ["lastRun", z.object({ version: z.literal(1) }).loose()],
  [
    "usage",
    z.object({
      version: z.literal(1),
      speechify: z.object({ month: z.string(), characters: z.number() }),
    }),
  ],
  ["sourceHealth", z.object({ version: z.literal(1), sources: z.record(z.string(), z.unknown()) })],
] as const;

async function stateChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];
  for (const [key, schema] of STATE_SCHEMAS) {
    const rel = STATE_FILES[key];
    const id = `state.${rel.replace(/^state\//, "").replace(/\.json$/, "")}`;
    let text: string | null;
    try {
      text = await readFileIfPresent(join(root, rel));
    } catch {
      checks.push(fail(id, `${rel} cannot be read`, "Check file permissions."));
      continue;
    }
    if (text === null) {
      checks.push(ok(id, "not created yet"));
      continue;
    }
    try {
      schema.parse(JSON.parse(text));
      checks.push(ok(id, "valid"));
    } catch (error) {
      checks.push(
        fail(
          id,
          `${rel} is invalid (${firstIssue(error)})`,
          `Restore it from git: git checkout -- ${rel}`,
        ),
      );
    }
  }
  return checks;
}

interface KeySpec {
  name: keyof Env;
  /** What breaks without it, and what to do. */
  missing: string;
  optional?: boolean;
}

const KEYS: readonly KeySpec[] = [
  {
    name: "TYPESAFE_API_KEY",
    missing:
      "Jev is off: the Nebius fallback judge answers and digests are unverified. Get a key at console.typesafe.ai.",
  },
  {
    name: "NEBIUS_API_KEY",
    missing:
      "The API curator cannot run (agent mode still works). Create a key in the Nebius Token Factory console.",
  },
  {
    name: "EXA_API_KEY",
    missing: "Semantic discovery sources skip. Get a key from the Exa dashboard.",
  },
  {
    name: "FIRECRAWL_API_KEY",
    missing:
      "Feedless sources skip and extraction has no scrape fallback. Get a key from the Firecrawl dashboard.",
  },
  {
    name: "SPEECHIFY_API_KEY",
    missing: "Audio cannot be generated. Get a key from the Speechify API console.",
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    missing: "Audio cannot be uploaded or pruned. Copy it from the Vercel Blob store.",
  },
  {
    name: "YOUTUBE_API_KEY",
    missing: "Only needed for the one-time channel id lookup.",
    optional: true,
  },
];

function keyChecks(env: Env): Check[] {
  const checks = KEYS.map((key): Check => {
    const set = env[key.name] !== undefined;
    if (set) return ok(`key.${key.name}`, "set");
    return key.optional
      ? ok(`key.${key.name}`, "not set (optional)")
      : warn(`key.${key.name}`, "not set", key.missing);
  });
  const model = (name: "DISPATCH_MODEL" | "DISPATCH_FALLBACK_MODEL", consequence: string): Check =>
    env[name] === undefined
      ? warn(
          `model.${name}`,
          "not set",
          `${consequence} Run \`dispatch models\` to pick one, then set ${name} in .env.`,
        )
      : ok(`model.${name}`, `set (${env[name]})`);
  checks.push(
    model("DISPATCH_MODEL", "The writer cannot run."),
    model("DISPATCH_FALLBACK_MODEL", "There is no failover if the primary id is retired."),
  );
  return checks;
}

/** Offline checks: nothing here touches the network. */
export async function offlineChecks(
  root: string,
  env: Env,
  deps: Pick<DoctorDeps, "git" | "nodeVersion">,
): Promise<Check[]> {
  return [
    nodeCheck(deps.nodeVersion),
    ...(await gitChecks(root, deps.git)),
    ...(await configChecks(root)),
    ...(await stateChecks(root)),
    ...keyChecks(env),
  ];
}

// --- online -----------------------------------------------------------------

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

export function summarizeChecks(checks: readonly Check[], online: boolean): DoctorReport {
  const totals = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) totals[check.status] += 1;
  return { version: 1, online, ok: totals.fail === 0, totals, checks: [...checks] };
}

const MARK: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${MARK[check.status]}  ${check.id.padEnd(30)} ${check.summary}`);
    if (check.hint) lines.push(`      fix: ${check.hint}`);
  }
  lines.push(
    "",
    `${report.totals.ok} ok, ${report.totals.warn} warnings, ${report.totals.fail} failed${report.online ? "" : " (offline; add --online to check the services)"}`,
  );
  return lines.join("\n");
}

export async function runDoctor(
  ctx: CommandContext,
  deps: DoctorDeps,
  online: boolean,
  secrets: readonly string[],
): Promise<DoctorReport> {
  const checks = await offlineChecks(ctx.root, ctx.env, deps);
  if (online) checks.push(...(await onlineChecks(ctx.env, deps, secrets)));
  return summarizeChecks(checks, online);
}
