# The owner's open tasks, checked

2026-10-24. The owner pasted two lists of open items from other sessions and asked which were still open, split into theirs and Claude's.

## What was checked

- GitHub: `main` reported unprotected (the D175 ruleset not imported), `branches.yml` logged `NEON_API_KEY` and `NEON_PROJECT_ID` empty at 16:20 (the owner set them after), `claude/lock-actions` still present (the agent proxy refuses a branch delete, so the owner deletes it).
- The review bot's empty pass on #221 did not recur: later runs post "No issues found". The cause was already a learning (a re-labelled run of a reviewed PR posts nothing).
- Production's Create page carried no passphrase; Play, Create and a settings save were not exercised.
- The new-source edit bug was real and fixed in #262: the site's parser dropped `id` and `format` from `source.add`.
- `generalCandidates` and the V8 bug: not reproduced ([the V8 note](2026-10-24-sound-test-and-a-v8-bug.md)).

## Parked

Google sign-in for the owner was built (four Vercel settings, three routes, the write routes gated, narration replaying stored audio to visitors) and parked by the owner the same hour. The patch is in the project's files as `login-parked/google-login-d177.patch`; its decision number collides with the rename's D177 and needs a new one.

## Moved from state

Two items of state.md's Next, to keep the read-first docs under budget:

- Calibrate the Jev thresholds on the golden set (`eval/run.ts --only judges`); apply the source pass-rate nudge in the `curate` path; tune the Trending threshold on a real briefing. (state.md's "Thresholds untuned" item tracks the gap.)
- Tests left by the D99 cuts, if they cost less than they save: `gate-decideRun` DST cases, `voice-lint`, the `heldSave` and `readerContract` tables, the Library filter table.

## Learnings removed

Six lines now enforced elsewhere: a new test shown red first and a full browser run before a site PR (AGENTS.md Tests and Commands), a deleted function's last call and a lazy-only glyph (the gate's `astro check`), a dev server left across an install (AGENTS.md Commands), and `vercel.json`'s schema (`vercelJson.test.ts`).
