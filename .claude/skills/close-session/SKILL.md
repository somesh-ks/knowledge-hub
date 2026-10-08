---
name: close-session
description: "Close out a Dispatch working session: rewrite docs/state.md, add a numbered decision with its Index row when direction changed, one learnings line per failure, and a note under docs/history/. Use when the user types /close-session or says wrap up the session, update the docs. Runs in the main thread because it needs this conversation's context. Not for committing or for editing Digests/ or state/."
disable-model-invocation: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash(git status:*)
  - Bash(git diff --stat:*)
  - Bash(git log:*)
---

# Close session

Follows "Keeping the record" in `AGENTS.md`. Each fact lives in one place; link to it from the others. No em dashes. Make surgical edits.

1. List from this conversation: what changed, what failed, what was decided, what was not verified. Use `git diff --stat` and `git log` to confirm.
2. `docs/state.md`: rewrite the affected lines so it describes now. Never append a log.
3. `docs/decisions.md`: only if direction changed. Grep the Index for the last D-number, add the next entry and an Index row (status `active`). Mark any decision it replaces.
4. `docs/learnings.md`: one line per failure or gotcha. Grep first; skip duplicates.
5. `docs/history/`: one note named `YYYY-MM-DD-<topic>.md`, only the why behind the change. Match the format in `docs/history/README.md`.
6. Do not touch `Digests/` or `state/`. Do not commit.

Return a list of the files changed, one line each, and anything unverified.
