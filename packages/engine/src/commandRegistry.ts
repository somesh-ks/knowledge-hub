import type { CommandRun } from "./context.js";
import { RUN_USAGE } from "./run/usage.js";

export interface CommandSpec {
  name: string;
  /** One line for the command list. */
  summary: string;
  /** Printed by `singularity <command> --help`. */
  help: string;
  /** Loaded on first use, so `singularity status` does not pay for the model SDKs. */
  load: () => Promise<CommandRun>;
}

/** Every command, in the order `singularity --help` lists them. Each module exports `run`. */
export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "classify-formats",
    summary: "Ask Jev for every source's format and write a review table",
    help: `Usage: singularity classify-formats [--out <dir>] [--apply <formats.json>]

Asks Jev which format (blog, news, forum, video, research, releases, podcast) each source is and
writes format-review.md and formats.json to --out. A row where Jev contradicts a type that decides
its own format is flagged and keeps the rule's value. --apply writes a reviewed formats.json into
config/sources.json and config/sources.user.json. Uses TYPESAFE_API_KEY.`,
    load: async () => (await import("./commands/classifyFormats.js")).run,
  },
  {
    name: "classify-lean",
    summary: "Ask Jev for the political lean of every general news source and write a review table",
    help: `Usage: singularity classify-lean [--out <dir>] [--apply <lean.json>]

Asks Jev for the lean (Left, Centre-left, Centre, Centre-right, Right, or unrated) of each source
that feeds a general news topic, and writes lean-review.md and lean.json to --out. --apply writes a
reviewed lean.json into config/sources.json and config/sources.user.json. Uses TYPESAFE_API_KEY.`,
    load: async () => (await import("./commands/classifyLean.js")).run,
  },
  {
    name: "sources",
    summary: "Import, discover and check the source registry",
    help: `Usage: singularity sources <import|discover|check> [flags]

  import [--fresh] [--dry-run]      Build config/sources.json from config/sources.md. Offline.
  discover [--all] [--only a,b] [--dry-run]
                                    Find and verify feeds. Uses the network.
  check [--only a,b] [--strict]     Reachability pass over every enabled source. Uses the network.
  suggest --topic <id> [--dry-run]  Find feeds for a custom topic with Exa, score them, and add the
                                    best to config/sources.user.json. Uses Exa, Jev and the network.`,
    load: async () => (await import("./commands/sources.js")).run,
  },
  {
    name: "log-run",
    summary: "Write the run that just ended, with each stage's time and cost, to Neon",
    help: `Usage: singularity log-run --result <success|failure|cancelled> [--outcome <published|nothing>]

run.yml's last step (D219): writes the run in .cache/run to the pipeline_runs and pipeline_stages
tables in DATABASE_URL, whatever its end. A log that cannot be written warns and exits 0.`,
    load: async () => (await import("./commands/logRun.js")).run,
  },
  {
    name: "config",
    summary: "Apply one topic or source change from the app, and commit it",
    help: `Usage:
  singularity config apply --op '<json>' [--dry-run]    One ConfigOp: topic.upsert, topic.remove,
                                                      source.add, source.set, source.remove,
                                                      mix.set, topic.mix, schedule.set, topic.scope,
                                                      structure.set, profile.block, profile.unblock,
                                                      profile.vote
  singularity config commit --message <text> [--no-push] Commit what apply wrote as chore(config): <text>

Writes config/topics.json, config/sources.user.json, config/queries.json, config/preferences.json,
config/schedule.json, config/structure.json, config/profiles/owner.json and
state/source-candidates.json, and nothing else; the write guard enforces it.`,
    load: async () => (await import("./commands/config.js")).run,
  },
  {
    name: "fetch",
    summary: "Gather candidates since the last run into a pool",
    help: `Usage: singularity fetch [--since <iso>] [--weekly] [--out <path>] [--id <digest-id>] [--update-health]

Normalizes, dedupes and prefilters candidates into .cache/run/<id>/pool.json. Uses the network;
sources with a missing API key skip. Agent mode starts here (see \`singularity run --help\`).`,
    load: async () => (await import("./commands/fetch.js")).run,
  },
  {
    name: "curate",
    summary: "Judge, select, write and ground a pool (api) or validate a selection (agent)",
    help: `Usage: singularity curate [--mode api|agent] [--kind regular|weekly|on-demand] [--pool <path>]
                       [--out <dir>] [--run <id>] [--since <iso>] [--threshold <0-1>]

api mode needs ANTHROPIC_API_KEY or GEMINI_API_KEY (models follow config/models.json) and spends tokens. agent mode writes
selection-schema.json, then validates the agent-selection.json a Claude Code session wrote.`,
    load: async () => (await import("./commands/curate.js")).run,
  },
  {
    name: "validate",
    summary: "Check any digest file against the schema and voice rules",
    help: "Usage: singularity validate <digest-path> [--pool <path>]\n\nExit 1 when the digest has errors. With --pool it also checks every URL came from the pool.",
    load: async () => (await import("./commands/validate.js")).run,
  },
  {
    name: "render",
    summary: "Turn a run's selection into a digest file",
    help: "Usage: singularity render [--run <id>] [--selection <path>] [--pool <path>] [--dry-run]\n\nWrites Digests/YYYY/MM/<id>.md without ever overwriting. It does not commit; `singularity run --stage commit` does.",
    load: async () => (await import("./commands/render.js")).run,
  },
  {
    name: "audio",
    summary: "Narrate one digest and upload it, without committing",
    help: "Usage: singularity audio --digest <id> [--dry-run] [--force]\n\nUses SPEECHIFY_API_KEY and BLOB_READ_WRITE_TOKEN and spends Speechify characters.",
    load: async () => (await import("./commands/audio.js")).run,
  },
  {
    name: "publish",
    summary: "Narrate every digest that lacks audio, upload, prune and commit",
    help: "Usage: singularity publish [--digest <id>] [--prune <days>] [--no-push]\n\nWhat audio.yml runs. A failed narration leaves audio null and does not fail the command.",
    load: async () => (await import("./commands/publish.js")).run,
  },
  {
    name: "learn",
    summary: "Apply a bounded preference patch",
    help: `Usage:
  singularity learn --schema                          Print the JSON Schema of a preferences patch
  singularity learn --apply <patch.json> [--dry-run]  Apply a patch (keywords, authors, disliked patterns)
  singularity learn --apply <patch.json> --commit [--no-push]
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
    name: "content",
    summary: "Mirror the digests, episodes and run state into the content store (Blob)",
    help: `Usage: singularity content sync

Uploads every file under Digests/ and Podcasts/ and the run state the site reads to Vercel Blob
under content/<path>, deletes what is gone and rewrites content/manifest.json and the episode
index. Only changed files are sent. Uses BLOB_READ_WRITE_TOKEN (D173).`,
    load: async () => (await import("./commands/content.js")).run,
  },
  {
    name: "podcast",
    summary: "Write one episode of Singularity from published digests and commit it",
    help: `Usage: singularity podcast --request '<json>' [--now <iso>] [--no-push]
       singularity podcast --request '<json>' --dry-run [--save <path outside the repository>]

The request is JSON: { topic_ids: string[1..50], length_minutes: 3|5|10|15,
format: "readout"|"discussion", window_days: 2|7|30,
tone: "neutral"|"energetic", voice_id?: string|null, voice_id_b?: string|null,
host_names?: { a: string, b: string }, title?: string }. voice_id is the lead host's Speechify
voice and voice_id_b the second host's (discussion only); null or absent means the default.
host_names are the two hosts' names in a discussion, which the site picks from the voices'
genders; absent means a gender-neutral pair. The episode stores the names a discussion was
written with, and a readout names no host. An episode already stored as headlines
still plays and can be regenerated. Topic ids are sections or categories as they
appear in published digests. Reads Digests/ only (no fetching), makes one writer call on the routed podcast models
(needs ANTHROPIC_API_KEY or GEMINI_API_KEY, spends tokens), writes Podcasts/YYYY/MM/<id>.md and
commits it as feat(podcast) through the write guard. The last line printed is the episode id.

--dry-run runs the whole pipeline with the real writer (it spends tokens) but writes nothing under
Podcasts/, commits and pushes nothing, and prints one JSON line last: audience, format,
length_minutes, topic_ids, budget_chars, script_chars, percent_of_budget, listen_minutes, turns,
speakers, stories, empty_topics, writer_calls, short_by_chars, title, problems. --save writes the
episode Markdown to a path outside the repository. It cannot be combined with --no-push.`,
    load: async () => (await import("./commands/podcast.js")).run,
  },
  {
    name: "costs",
    summary:
      "Total the cost ledger by day, week or month, grouped, with per-run and per-user averages",
    help: `Usage: singularity costs [--period day|week|month] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                      [--by provider|kind|timezone|user|product|scope] [--tz <zone>] [--json]

Reads state/costs-*.json (written by run, publish and podcast) and prices from config/prices.json.
Days are counted in --tz (default: the schedule's zone). Offline. Narration on Play is read by the
Settings page from the site's usage store, not here.`,
    load: async () => (await import("./commands/costs.js")).run,
  },
  {
    name: "status",
    summary: "Last runs, next due date, audio, failing sources and budget (offline)",
    help: `Usage: singularity status [--json]

Reads the repository files only. With --json prints { version: 1, now, last_run, last_fetch_at,
next_regular_due, due_now, latest_digest, audio, sources, budget }.`,
    load: async () => (await import("./commands/status.js")).run,
  },
  {
    name: "metrics",
    summary:
      "How healthy generation is: length, grounding, speed and failures against their targets",
    help: `Usage: singularity metrics [--json]

Reads state/run-metrics.json and state/podcast-timings.json (offline) and prints each metric of
docs/engineering/metrics.md over the newest ten runs with its target and whether it is met. A
metric needs three runs before it is judged. With --json prints the same as data.`,
    load: async () => (await import("./commands/metrics.js")).run,
  },
  {
    name: "health",
    summary: "Faults in runs, narration, data, cost and the live site; exits 1 on a fault",
    help: `Usage: singularity health [--offline] [--site <origin>] [--ceiling-usd <n>] [--json]

Checks the last run's outcome and the next due date, narration for the last week, that every digest
and state file parses, a thin or unverified newest briefing, model fallbacks in the last run, the
cost ledger's last 24 hours against --ceiling-usd (default 5) and the Speechify allowance. Online
(the default; --offline skips it) it asks the live site (default https://news.someshks.work) for its
pages, headers, /api/podcast, /latest.json against the newest digest, and the newest narration
file. With --json prints { version: 1, now, ok, findings: [{ code, aspect, severity, message }],
passed }. Exits 1 when any finding is a fault.`,
    load: async () => (await import("./commands/health.js")).run,
  },
  {
    name: "doctor",
    summary: "Check the setup: Node, git, config, state, key names, and with --online the services",
    help: `Usage: singularity doctor [--online] [--json]

Offline checks cover Node 24 or newer, git, the repository, config and state files, which key
NAMES are set (never values) and config/models.json. --online adds authenticated requests: the
Anthropic and Gemini model lists answer, Jev answers a trivial question,
Exa answers one search (about 0.007 USD), Firecrawl reports credits, Speechify lists the voice
id and Vercel Blob accepts a list call. Each check prints ok, warn or fail with a fix hint;
exit 1 when any check fails.`,
    load: async () => (await import("./commands/doctor.js")).run,
  },
  {
    name: "extract",
    summary: "Full text for chosen pool items (agent mode)",
    help: `Usage: singularity extract --ids <a,b,c> [--pool <path>] [--run <id>] [--max-chars <n>]

Prints one JSON object on stdout mapping each item id to its extracted text, capped per item and
in total (default 60000 characters). Ids missing from the pool or without readable text are
listed on stderr. Uses the network, and Firecrawl when FIRECRAWL_API_KEY is set.`,
    load: async () => (await import("./commands/extract.js")).run,
  },
  {
    name: "models",
    summary: "Show the model routing and the model each family resolves to",
    help: `Usage: singularity models [--json]

Reads config/models.json and, with keys, lists the providers' models to show the newest id each
family resolves to (Jev, Claude Sonnet and Haiku, Gemini Flash and Flash-Lite only).`,
    load: async () => (await import("./commands/models.js")).run,
  },
  {
    name: "voices",
    summary: "List the Speechify voices available to your key",
    help: `Usage: singularity voices [--locale <prefix>] [--limit <n>] [--json]

Lists id, name, gender and locales from GET /v1/voices, to pick SPEECHIFY_VOICE_ID. Defaults to
locales starting with "en". Output is capped (default 40).`,
    load: async () => (await import("./commands/voices.js")).run,
  },
  {
    name: "eval",
    summary: "Golden-set evaluation of judges, grounding and writer models (uses keys and money)",
    help: `Usage: singularity eval --yes [--only judges,grounding] [--json]

Calls TypeSafe Jev and the routed Claude and Gemini models with your keys and costs a few cents per run. It
never runs in CI. Without --yes it prints this notice and exits 2.`,
    load: async () => (await import("./commands/eval.js")).run,
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}
