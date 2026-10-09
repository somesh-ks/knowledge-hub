import type { CommandRun } from "./context.js";
import { RUN_USAGE } from "./run/usage.js";

export interface CommandSpec {
  name: string;
  /** One line for the command list. */
  summary: string;
  /** Printed by `dispatch <command> --help`. */
  help: string;
  /** Loaded on first use, so `dispatch status` does not pay for the model SDKs. */
  load: () => Promise<CommandRun>;
}

/** Every command, in the order `dispatch --help` lists them. Each module exports `run`. */
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "sources",
    summary: "Import, discover and check the source registry",
    help: `Usage: dispatch sources <import|discover|check> [flags]

  import [--fresh] [--dry-run]      Build config/sources.json from config/sources.md. Offline.
  discover [--all] [--only a,b] [--dry-run]
                                    Find and verify feeds. Uses the network.
  check [--only a,b] [--strict]     Reachability pass over every enabled source. Uses the network.
  suggest --topic <id> [--dry-run]  Find feeds for a custom topic with Exa, score them, and add the
                                    best to config/sources.user.json. Uses Exa, Jev and the network.`,
    load: async () => (await import("./commands/sources.js")).run,
  },
  {
    name: "config",
    summary: "Apply one topic, source or weight change from the app, and commit it",
    help: `Usage:
  dispatch config apply --op '<json>' [--dry-run]    One ConfigOp: topic.upsert, topic.remove,
                                                      source.add, source.set, source.remove, weights.set,
                                                      schedule.set
  dispatch config commit --message <text> [--no-push] Commit what apply wrote as chore(config): <text>

Writes config/topics.json, config/sources.user.json, config/queries.json, config/preferences.json,
config/schedule.json and state/source-candidates.json, and nothing else; the write guard enforces it.`,
    load: async () => (await import("./commands/config.js")).run,
  },
  {
    name: "fetch",
    summary: "Gather candidates since the last run into a pool",
    help: `Usage: dispatch fetch [--since <iso>] [--weekly] [--out <path>] [--id <digest-id>] [--update-health]

Normalizes, dedupes and prefilters candidates into .cache/run/<id>/pool.json. Uses the network;
sources with a missing API key skip. Agent mode starts here (see \`dispatch run --help\`).`,
    load: async () => (await import("./commands/fetch.js")).run,
  },
  {
    name: "curate",
    summary: "Judge, select, write and ground a pool (api) or validate a selection (agent)",
    help: `Usage: dispatch curate [--mode api|agent] [--kind regular|weekly|on-demand] [--pool <path>]
                       [--out <dir>] [--run <id>] [--since <iso>] [--threshold <0-1>]

api mode needs NEBIUS_API_KEY and DISPATCH_MODEL and spends tokens. agent mode writes
selection-schema.json, then validates the agent-selection.json a Claude Code session wrote.`,
    load: async () => (await import("./commands/curate.js")).run,
  },
  {
    name: "validate",
    summary: "Check any digest file against the schema and voice rules",
    help: "Usage: dispatch validate <digest-path> [--pool <path>]\n\nExit 1 when the digest has errors. With --pool it also checks every URL came from the pool.",
    load: async () => (await import("./commands/validate.js")).run,
  },
  {
    name: "render",
    summary: "Turn a run's selection into a digest file",
    help: "Usage: dispatch render [--run <id>] [--selection <path>] [--pool <path>] [--dry-run]\n\nWrites Digests/YYYY/MM/<id>.md without ever overwriting. It does not commit; `dispatch run --stage commit` does.",
    load: async () => (await import("./commands/render.js")).run,
  },
  {
    name: "audio",
    summary: "Narrate one digest and upload it, without committing",
    help: "Usage: dispatch audio --digest <id> [--dry-run] [--force]\n\nUses SPEECHIFY_API_KEY and BLOB_READ_WRITE_TOKEN and spends Speechify characters.",
    load: async () => (await import("./commands/audio.js")).run,
  },
  {
    name: "publish",
    summary: "Narrate every digest that lacks audio, upload, prune and commit",
    help: "Usage: dispatch publish [--digest <id>] [--prune <days>] [--no-push]\n\nWhat audio.yml runs. A failed narration leaves audio null and does not fail the command.",
    load: async () => (await import("./commands/publish.js")).run,
  },
  {
    name: "learn",
    summary: "Apply a bounded preference patch",
    help: `Usage:
  dispatch learn --schema                          Print the JSON Schema of a preferences patch
  dispatch learn --apply <patch.json> [--dry-run]  Apply a patch within the bounds (0.05 per weight, 0.15 total)
  dispatch learn --apply <patch.json> --commit [--no-push]
                                                   Also commit config/preferences.json as
                                                   chore(prefs): <summary> and push. Refuses on a
                                                   dirty tree or when behind the remote.`,
    load: async () => (await import("./commands/learn.js")).run,
  },
  {
    name: "run",
    summary: "The staged pipeline: gate, fetch, judge, write, validate, commit",
    help: RUN_USAGE,
    load: async () => (await import("./commands/run.js")).run,
  },
  {
    name: "podcast",
    summary: "Write one episode of Singularity from published digests and commit it",
    help: `Usage: dispatch podcast --request '<json>' [--now <iso>] [--no-push]
       dispatch podcast --request '<json>' --dry-run [--save <path outside the repository>]

The request is JSON: { topic_ids: string[1..50], length_minutes: 3|5|10|15,
format: "readout"|"discussion"|"headlines", window_days: 2|7|30,
tone: "neutral"|"energetic"|"dry", title?: string }. Topic ids are sections or categories as they
appear in published digests. Reads Digests/ only (no fetching), makes one writer call on Nebius
(needs NEBIUS_API_KEY and DISPATCH_MODEL, spends tokens), writes Podcasts/YYYY/MM/<id>.md and
commits it as feat(podcast) through the write guard. The last line printed is the episode id.

--dry-run runs the whole pipeline with the real writer (it spends tokens) but writes nothing under
Podcasts/, commits and pushes nothing, and prints one JSON line last: audience, format,
length_minutes, topic_ids, budget_chars, script_chars, percent_of_budget, listen_minutes, turns,
speakers, stories, empty_topics, writer_calls, short_by_chars, title, problems. --save writes the
episode Markdown to a path outside the repository. It cannot be combined with --no-push.`,
    load: async () => (await import("./commands/podcast.js")).run,
  },
  {
    name: "status",
    summary: "Last runs, next due date, audio, failing sources and budget (offline)",
    help: `Usage: dispatch status [--json]

Reads the repository files only. With --json prints { version: 1, now, last_run, last_fetch_at,
next_regular_due, due_now, latest_digest, audio, sources, budget }.`,
    load: async () => (await import("./commands/status.js")).run,
  },
  {
    name: "doctor",
    summary: "Check the setup: Node, git, config, state, key names, and with --online the services",
    help: `Usage: dispatch doctor [--online] [--json]

Offline checks cover Node 24 or newer, git, the repository, config and state files, which key
NAMES are set (never values) and the model ids. --online adds authenticated requests: Nebius
/v1/models must list DISPATCH_MODEL and DISPATCH_FALLBACK_MODEL, Jev answers a trivial question,
Exa answers one search (about 0.007 USD), Firecrawl reports credits, Speechify lists the voice
id and Vercel Blob accepts a list call. Each check prints ok, warn or fail with a fix hint;
exit 1 when any check fails.`,
    load: async () => (await import("./commands/doctor.js")).run,
  },
  {
    name: "extract",
    summary: "Full text for chosen pool items (agent mode)",
    help: `Usage: dispatch extract --ids <a,b,c> [--pool <path>] [--run <id>] [--max-chars <n>]

Prints one JSON object on stdout mapping each item id to its extracted text, capped per item and
in total (default 60000 characters). Ids missing from the pool or without readable text are
listed on stderr. Uses the network, and Firecrawl when FIRECRAWL_API_KEY is set.`,
    load: async () => (await import("./commands/extract.js")).run,
  },
  {
    name: "models",
    summary: "List the Nebius text models available to your key",
    help: `Usage: dispatch models [--all] [--limit <n>] [--json]

Lists id and context length from GET /v1/models, to pick DISPATCH_MODEL for the bake-off.
Embedding, image and rerank models are hidden unless --all. Output is capped (default 60).`,
    load: async () => (await import("./commands/models.js")).run,
  },
  {
    name: "voices",
    summary: "List the Speechify voices available to your key",
    help: `Usage: dispatch voices [--locale <prefix>] [--limit <n>] [--json]

Lists id, name, gender and locales from GET /v1/voices, to pick SPEECHIFY_VOICE_ID. Defaults to
locales starting with "en". Output is capped (default 40).`,
    load: async () => (await import("./commands/voices.js")).run,
  },
  {
    name: "eval",
    summary: "Golden-set evaluation of judges, grounding and writer models (uses keys and money)",
    help: `Usage: dispatch eval --yes [--only judges,grounding,bakeoff] [--models a,b] [--thinking <spec>] [--json]

Calls TypeSafe Jev and Nebius Token Factory with your keys and costs a few cents per run. It
never runs in CI. Without --yes it prints this notice and exits 2.`,
    load: async () => (await import("./commands/eval.js")).run,
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}
