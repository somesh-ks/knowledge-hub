import { join } from "node:path";
import { type Env, loadModelRouting, Preferences, STATE_FILES } from "@singularity/core";
import { z } from "zod";
import { loadQueries } from "../fetch/queries.js";
import type { GitRunner } from "../git/runGit.js";
import { parseSources } from "../sources/registry.js";
import { parseVoice } from "../voice/voice.js";
import {
  type Check,
  type DoctorDeps,
  fail,
  firstIssue,
  MIN_NODE_MAJOR,
  ok,
  readFileIfPresent,
  warn,
} from "./doctorTypes.js";

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

export async function configChecks(root: string): Promise<Check[]> {
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
      fail("config.sources", "config/sources.json is missing", "Run `singularity sources import`."),
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
          "Run `singularity sources import` to rebuild it from config/sources.md.",
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
      "Jev is off: the Haiku or Flash-Lite fallback judge answers and digests are unverified. Get a key at console.typesafe.ai.",
  },
  {
    name: "ANTHROPIC_API_KEY",
    missing:
      "The story and script writers (Claude Sonnet) and the Haiku fallbacks are off; Gemini Flash writes instead. Create a key in the Anthropic console.",
  },
  {
    name: "GEMINI_API_KEY",
    missing:
      "YouTube transcription and the Gemini fallbacks are off. Create a key in Google AI Studio.",
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
    name: "VERCEL_TOKEN",
    missing:
      "The audio workflow cannot pull Blob credentials. Create an account token in the Vercel dashboard (Settings, Tokens).",
  },
];

function keyChecks(env: Env, root: string): Check[] {
  const checks = KEYS.map((key): Check => {
    const set = env[key.name] !== undefined;
    if (set) return ok(`key.${key.name}`, "set");
    return key.optional
      ? ok(`key.${key.name}`, "not set (optional)")
      : warn(`key.${key.name}`, "not set", key.missing);
  });
  try {
    const routing = loadModelRouting(root);
    checks.push(ok("models.routing", `${Object.keys(routing.steps).length} steps routed`));
  } catch (error) {
    checks.push(
      fail(
        "models.routing",
        error instanceof Error ? error.message.slice(0, 200) : "config/models.json cannot be read",
        "Fix config/models.json: only jev, claude-sonnet, claude-haiku, gemini-flash and gemini-flash-lite are allowed.",
      ),
    );
  }
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
    ...keyChecks(env, root),
  ];
}
