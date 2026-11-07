# Run state in Postgres

2026-11-06. Thread: Audit/storage. D300 step 3, D381. PR 1 is #740.

## What changed

- #740: the `state_documents` table and `singularity state pull | seed | push` (`store/stateDocs.ts`). A pull records each row's version and text hash in `.cache/state-pulled.json`; a push writes only files that differ, on that version, and merges a moved row with `stateMergerFor`. Seen, judgments and last-run have no merger, so a conflict is refused. A push with no pull record is refused.
- This PR: `SINGULARITY_STATE_STORE` switch (off by default). `cli.ts` pulls before `run` (gate), `podcast` (first stage), `ingest` and `health`; `commitAndPush` pushes after the git push for `run`, `podcast` and `costs` and reports a failed save as `push_failed` with reason `state_store`.

## Not done

- No workflow passes the switch for the other jobs yet (step 4). Step 3c (this thread's third PR) gives the audio job its own login, `audio_state` with row-level security on its two kinds of file, and `publish` pulls and saves only those; it takes effect once the owner runs the SQL in runbook 14 and adds `AUDIO_DATABASE_URL`.
- The write guard still reads `git status`; it needs hash-baseline change detection before `state/` stops being committed (step 5).
- Unverified on Neon.
