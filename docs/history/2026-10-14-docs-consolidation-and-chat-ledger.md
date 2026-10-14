# 2026-10-14: Docs consolidation and the ledger from the chats

## What changed and why
- Local `main` was 48 commits behind `origin/main`; it was fast-forwarded to `8549f27`.
- Three finished worktrees (`fix/flaky-tests`, `docs/first-load-measure`, `feat/monthly-covers`, all merged as #107 to #109) were unlinked with `scripts/worktreeLinks.mjs --remove` and removed; main's `node_modules` was checked before and after. An empty leftover folder, `.claude/worktrees/agent-ae6bb0d8ae35becb2`, is held open by another process and stays.
- The 50 local branches stay. Every non-merge commit subject on each appears in main's history, but squash merges fail `git branch -d` and the classifier refused `-D`. All 50 heads are kept in `.git/branch-archive-2026-10-14.bundle` for the owner to delete with `-D` (learnings). On 2026-10-15, with the owner's go-ahead, all 52 local branches and the 16 merged branches on GitHub were deleted; the heads are in `.git/branch-archive-2026-10-15.bundle`.
- `docs/` grouped by purpose (D116): `plan/`, `engineering/`, the two 2026-10-11 audits folded into their history notes, `docs/README.md` as the map. The plan docs no longer claim nothing has run live.
- The design-engineering ledger gained what only the chats held. Four workers read the owner's messages, the replies and the compaction summaries of 14 local sessions (2026-10-05 to 2026-10-14). A fifth checked 36 code claims against `main`; a sixth matched 36 lessons against the `sk-design-engineering` plugin. New in the ledger: how to work with the owner on UI (section 2), a table of reusable mechanisms (section 5) and a skill enrichment queue (section 10). Dated quotes and new items run through the rest.

## What the code check changed
Claims from the chats that the code contradicts were written as the code is:
- The open player's Play keeps its accent disc; only the bar's play lost it.
- `lead_words` is computed in the web library, not the engine.
- A safe triangle for the volume slider, raised in a chat, was rejected on purpose in D106, so it is not listed as a gap.
- About is back on Settings, so it left the open asks.
