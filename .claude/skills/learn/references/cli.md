# CLI contracts used by /learn

`D` is `npm run --silent dispatch --` from the repository root. Global exit codes: 0 success, 1 failure, 2 usage error. Logs go to stderr with a level prefix (`info:`, `warn:`, `error:`); the diff goes to stdout. Checked against the CLI help and sources on 2026-10-06; if a flag or message differs, trust `D learn --help` and report the mismatch.

## Dispatch commands

| Command | Exit codes | Output |
| :--- | :--- | :--- |
| `D learn --schema` | 0 | JSON Schema of the patch, about 90 lines. All eight fields are listed as required, so always write all of them. `weight_deltas` keys are the ten categories; each delta is a number from -1 to 1. Lists hold at most 10 entries; keywords and authors at most 60 characters, disliked patterns at most 80; `input` is 1 to 500 characters. |
| `D learn --apply <patch.json> --dry-run` | 0 | Writes nothing. stdout: one `+ <change>` line per change. stderr: `warn: Clamped: ...` lines when the CLI had to clamp. When nothing would change: `info: No changes: the patch matched the current preferences.` and no diff. |
| `D learn --apply <patch.json>` | 0, 1 | Writes `config/preferences.json` only (2-space JSON, trailing newline) and appends one `feedback_history` entry. Prints the same diff, then `info: Updated config/preferences.json. Review the diff, then commit as "chore(prefs): ...".` Exit 1 and `dispatch: learn failed: <first line>` when the patch is unreadable or breaks the schema; the first line of a schema error is often just `[`. |
| `D learn --apply <patch.json> --commit [--no-push]` | 0, 1, 2 | After writing, commits `config/preferences.json` only as `chore(prefs): <summary>` with the input and every change in the body, then pushes unless `--no-push`. Success: `info: Committed and pushed <sha7>.` or `info: Committed <sha7> (not pushed).` |

`--commit` refusals (exit 1, nothing written, the diff has already been printed):

| Message | Meaning | Fix |
| :--- | :--- | :--- |
| `The working tree has uncommitted changes. Commit or stash them first: ...` | Dirty tree | Commit or stash, rerun. Check `git status --porcelain` first so the user is not asked to confirm in vain. |
| `The branch is behind its remote. Run git pull --ff-only first.` | Remote moved | `git pull --ff-only`, rerun. |
| `Cannot reach the remote to check whether the branch is behind (...)` | No network or no remote | Fix the connection, or use `--no-push`. |
| `Committed <sha7> but the push failed (...)` | Commit exists locally | Push later; do not rerun the apply. |

`--no-push` without `--commit`, or `--commit` with `--dry-run`, exits 2 and prints the usage text.

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

Notes: `capped` (asked more than 0.05), `headroom` (the weight is near 0 or 1), `skipped` (no-op or contradiction), `deferred` (per-call budget or list size). The default path is `dispatch-learn-<UTC timestamp>.json` in the OS temp directory.
