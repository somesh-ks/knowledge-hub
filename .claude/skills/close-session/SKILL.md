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
  - Agent
  - Bash(git status:*)
  - Bash(git diff --stat:*)
  - Bash(git log:*)
  - Bash(node scripts/docsCheck.mjs:*)
---

# Close session

Follows "Keeping the record" in `AGENTS.md`. Each fact lives in one place; link to it from the others. No em dashes. Make surgical edits.

1. List from this conversation: what changed, what failed, what was decided, what was not verified. Use `git diff --stat` and `git log` to confirm.
2. `docs/specs/`: only if this session found a spec wrong or changed what one describes, fix those lines.
3. `docs/state.md`: rewrite the affected lines so it describes now. Never append a log; the story of the session goes in the history note. Every new unverified line ends with `closed when:` and one testable condition; delete the lines this session closed. If tests were added or removed, update their counts and run times there.
4. `docs/decisions.md`: only if direction changed. Grep the Index for the last D-number, add the next entry and an Index row (status `active`). Mark any decision it replaces; the new entry adds `- Context changed:`, and `- Revisit if:` when its reason can expire.
5. `docs/learnings.md`: one line per failure or gotcha, under its area heading. Grep first; skip duplicates. Delete a gotcha that code, a check or `AGENTS.md` now enforces.
6. `docs/history/`: one note named `YYYY-MM-DD-<topic>.md`, only the why behind the change. Match the format in `docs/history/README.md`.
7. Run `node scripts/docsCheck.mjs` and fix what it reports.
8. If the session changed UI (`apps/web/src`, the tokens), confirm the `design-audit` agent ran on the diff; if not, run it now and list what it reports under unverified.
9. Do not touch `Digests/` or `state/`. Do not commit.

Return a list of the files changed, one line each, and anything unverified.
