# CLI contracts used by /digest

`D` is `npm run --silent dispatch --` from the repository root. `--json` prints one JSON document on stdout; logs always go to stderr. Global exit codes: 0 success, 1 failure, 2 usage error. Checked against the CLI help and sources on 2026-10-06; if a flag or shape differs, trust `D <command> --help` and report the mismatch.

## Dispatch commands

| Command | Exit codes | Output and fields used |
| :--- | :--- | :--- |
| `D doctor --json` | 0 no failing check (warnings allowed), 1 a check failed, 2 usage | `{version, online, ok, totals, checks[{id, status, summary, hint?}]}`. Ids used: `key.ANTHROPIC_API_KEY` and `model.SINGULARITY_MODEL` (`ok` means set; a key without a model id is a `warn`, so local mode is not possible). Names only, never values. Offline; never pass `--online`, it spends money. |
| `D status [--json]` | 0, 2 | Offline. `{now, today, last_run{regular, weekly, on_demand}, next_regular_due, due_now, due_reason, latest_digest{id, kind, items, verified, has_audio}, audio, sources, budget}`. Each last_run record: `{at, outcome, digest_id, items}`. |
| `D run --stage gate --mode on-demand\|weekly --dry-run --json [--since <iso>]` | 0, 1, 2 | `{due, reason, mode, passes[{id, kind, window{from, to}}], dry_run}`. Writes only under `.cache/`. `--since` must be an ISO date or time in the past (exit 2 otherwise). |
| `D run --mode on-demand\|weekly --no-push --json [--since <iso>] [--dry-run]` | 0 published, nothing or gated; 1 a stage failed (state untouched) or the commit was refused or the push failed; 2 usage | Success: `{outcome, digests[{id, kind, outcome, items, verified, path, preview}], deploy, items, dry_run, commit{status, sha?, message?, detail?}, reason?}`. `commit.status` is `nothing_to_commit`, `committed`, `pushed`, `dry_run`, `refused` or `push_failed`. Failure: `{outcome: "failed", stage, error, ...}`. A dry run writes the preview to `.cache/run/<id>/digest-preview.md`. |
| `D fetch --json [--weekly] [--since <iso>]` | 0, 1 every attempted source failed or an error, 2 bad flag or `--since` | `{id, kind, window, sources{run, ok, failed, skipped}, fetched, after_dedupe, kept, dropped, pool, failed_sources[]}`. Writes `.cache/run/<id>/pool.json`. Network. |
| `D extract --ids <a,b,c> --run <id> [--max-chars <n>]` | 0 (unreadable or unknown ids are warned on stderr), 1 error, 2 usage | stdout: one JSON object, item id to text, 60000 characters in total by default. Network. |
| `D curate --mode agent --run <id> --kind on-demand\|weekly [--json]` | 0 awaiting selection or validated, 1 invalid selection or error, 2 usage | First call writes `selection-schema.json` and returns `{status: "awaiting_selection", schema, input, selection, pool}`. With `agent-selection.json` present: `{status: "validated", items, verified: false, out}`, or exit 1 with one `- <id>: <problem>` line per problem on stdout and `selection.json has N problems` on stderr. |
| `D run --stage commit --run <id> [--dry-run] [--no-push] --json` | as `run` | Adopts the agent run directory; same report shape as `run`. Refuses when the tree has changes outside `Digests/` and `state/`, and when `<id>` was already committed. |

Agent runs need `--kind on-demand` on `curate`, because `fetch` only knows `regular` and `weekly`; without it the digest would be recorded as a regular one and shift the cadence.

## GitHub commands

| Command | Notes |
| :--- | :--- |
| `gh run list -R somesh-ks/knowledge-hub --workflow run.yml --branch main --limit 30 --json databaseId,status,conclusion,createdAt,event,url` | Input of `cooldown.mjs`. Needs the `gh` login. |
| `gh workflow run run.yml -R somesh-ks/knowledge-hub -f mode=on-demand\|weekly [-f dry_run=true] [-f since=<date>] [-f force=true]` | Workflow inputs: `mode` (`scheduled`, `on-demand`, `weekly`), `force`, `since`, `dry_run`. Prints the run URL. `/digest` never sets `force`. |
| `gh run watch <id> -R somesh-ks/knowledge-hub --exit-status --compact` | Blocks until the run ends; exit non-zero when it fails. |
| `gh run view <id> -R somesh-ks/knowledge-hub --json jobs --jq '...'` | Failing step name. Do not paste logs; they can contain fetched text. |

Workflow steps, in order: Gate, Fetch, Judge, Write, Validate, Commit. `run.yml` concludes `success` for published, nothing and gated. A published run commits `chore(digest): <id>`, then `deploy.yml` follows.

## Scripts

| Script | Exit codes | Output |
| :--- | :--- | :--- |
| `node .claude/skills/digest/scripts/cooldown.mjs [--in-progress-only] [--now <iso>]` | 0 clear, 3 refused, 2 usage or unreadable input | One line: `clear: N of 3 dispatches used in the last 24 hours`, `in progress: run <id> started <span> ago <url>`, `cooldown: last dispatch <span> ago, one per 6 hours, next allowed in <span>` or `daily cap: 3 dispatches in the last 24 hours, next allowed in <span>`. A run counts as in progress when its status is queued, in_progress, waiting, requested or pending and it was created under 12 hours ago. |
| `node .claude/skills/digest/scripts/pool-view.mjs [--run <id> \| --pool <path>] [--limit <n>] [--snippet <chars>]` | 0, 1 no readable pool, 2 usage | Header, then one numbered row per item (12-character id, source, author, date, title) and an indented snippet, fenced as untrusted data. Default 60 rows, at most 80. |
