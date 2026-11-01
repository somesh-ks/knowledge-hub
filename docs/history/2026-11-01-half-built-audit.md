# 2026-11-01: audit of half-built and unbuilt work

Somesh found that D209 step 3 (Batch API) had been decided and never built, and asked for a sweep of everything else. Seven read-only passes traced each decision, plan step and PR promise to code, workflow runs and production. The result was 41 items, 9 of high impact; the page is at https://claude.ai/artifact/R4oubVXX1qk74C3uERg4fh and the by-owner routing in the project files.

## What it found

- A decision or a plan step can say "done" or "planned" and be neither: D209 said "nothing built" with step 1 shipped; D170 said "not built" with phases 1 and 2 built; D282 was cited in code with no entry.
- Features shipped without anyone seeing them work: the 10-31 scheduled daily published nothing and state.md did not say so; the config store switches were never compared; push has no health check; the admin routes answered 503 in production.
- Owner calls that expired by silence: the repository is public while D9 says private, the main ruleset was never imported, and the Vercel plan decision (trial ends 11-13) was not in state.md.

## What this change did

Fixed the items that needed no decision: the stale spec lines, the Index statuses (D117, D123, D170, D209), D282 written, the state.md lines for the 10-31 daily, the cap gap (D213) and the parked pipeline steps, the Jev line in the runbook, two dead pieces of code (`forgetQueueItem`, the legacy `podcast` run title) and two stale comments. Issue #197 was closed after `/` and `/library` were seen answering with a CSP header.

## Left to the owner threads

Everything else is routed by owner in the project files (`audit-2026-11-01/by-owner.md`). Not touched here on purpose: `config/writer.json` (a store-synced file, D149), the audio job running after a delete (a workflow edit), the Perspective residue (`topic.mix`, `lean`; needs a decision superseding D124's perspective), and the Catch up cap after a late failure (a semantic change to D213).
