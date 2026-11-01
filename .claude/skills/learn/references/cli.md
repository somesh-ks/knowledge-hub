# CLI contracts used by /learn

`D` is `npm run --silent singularity --` from the repository root. Global exit codes: 0 success, 1 failure, 2 usage error. Logs go to stderr with a level prefix (`info:`, `warn:`, `error:`); the diff goes to stdout. Checked against the CLI help and sources on 2026-10-06; if a flag or message differs, trust `D learn --help` and report the mismatch.

## Singularity commands

| Command | Exit codes | Output |
| :--- | :--- | :--- |
| `D learn --schema` | 0 | JSON Schema of the patch, about 90 lines. All eight fields are listed as required, so always write all of them. `weight_deltas` keys are the ten categories; each delta is a number from -1 to 1. Lists hold at most 10 entries; keywords and authors at most 60 characters, disliked patterns at most 80; `input` is 1 to 500 characters. |
| `D learn --apply <patch.json> --dry-run` | 0 | Writes nothing. stdout: one `+ <change>` line per change. stderr: `warn: Clamped: ...` lines when the CLI had to clamp. When nothing would change: `info: No changes: the patch matched the current preferences.` and no diff. |
| `D learn --apply <patch.json>` | 0, 1 | Writes the stored preferences (the config store when it is on, and `config/preferences.json` as 2-space JSON with a trailing newline) and appends one `feedback_history` entry. Prints the same diff, then `info: Updated config/preferences.json.` (store off) or `info: Updated config/preferences.json and the config store.` (store on). Commits nothing. A valid patch that changes nothing exits 0 with `info: No changes` and writes nothing. Exit 1 with `error: Cannot read the patch at <path>: ...` or one `error: Invalid patch at <field>: ...` per problem when the patch is wrong. Exit 1 with an `error:` line naming the config store when the store cannot be read, or when only its write failed (the file is then updated and the stored copy is not: run it again when the store already holds a preferences row; without one, the rerun prints `info: No changes` and writes nothing). |

`--commit` and `--no-push` are accepted and do nothing: the preferences are not in git (D296).

## Change-line grammar

`weight <category>: <before> to <after>`, `keyword: added "<text>"`, `keyword: removed "<text>"`, and the same for `author` and `disliked`. The CLI skips an add that is already present (case-insensitive) and a remove that is absent.

## CLI bounds

Each delta is clamped to 0.05; when the absolute total passes 0.15 every delta is scaled down proportionally; results truncate to 0.01 and stay between 0 and 1. A float artifact can print `Clamped: total change 0.15 scaled to 0.15` for three deltas of 0.05; the diff lines are still exact, so ignore that warning. The helper below applies the same limits first and spends the budget in the order given, so the preview matches what is written.

## Helper

`node .claude/skills/learn/scripts/make-patch.mjs --input "<sentence>" [--weight <category>=<delta>]... [--add-keyword|--remove-keyword|--add-author|--remove-author|--add-disliked|--remove-disliked <text>]... [--prefs <path>] [--out <path>]`

| Exit code | Meaning |
| :--- | :--- |
| 0 | Patch written. stdout: notes, then `weights: ...` and `patch: <path>`. |
| 1 | Nothing left to change; no file written. |
| 2 | Usage error: unknown category, missing value, input over 500 characters, an entry both added and removed. |

Notes: `capped` (asked more than 0.05), `headroom` (the weight is near 0 or 1), `skipped` (no-op or contradiction), `deferred` (per-call budget or list size). The default path is `singularity-learn-<UTC timestamp>.json` in the OS temp directory.
