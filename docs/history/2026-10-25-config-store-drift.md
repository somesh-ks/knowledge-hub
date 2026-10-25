# The weekly that put old queries back

2026-10-25. The 06:52 UTC weekly ([run 40170639582](https://github.com/somesh-ks/knowledge-hub/actions/runs/40170639582)) spent about $1.95 and failed at the commit stage: "changes outside the write allowlist: config/queries.json".

## What happened

- The config store (D149) was seeded from `main` on 2026-10-24. #263 then changed `config/queries.json` in the repo (two `ai_ux` queries, the design-system query reworded) and never reached the store.
- The gate copied every stored row over its file, as D149 says: the store always won, so the old queries replaced the new ones without a word.
- The commit stage checks the tree before writing, against `ALLOWLISTS.run` alone; the guard in `commitAndPush` also allows the config files when the gate copied them. The early check refused the copy, so the weekly failed after its spend.
- `run --record-failed` went through the guard, which allowed the copy, and its commit (56e4ba1) put the old queries on `main`.

## What changed (D185)

- Snapshot commits carry `Config-Store: snapshot`; the gate compares a differing row and file with that commit's file. A repo-only edit goes to the store, an edit in both stops the gate before any spend, an app-only edit is copied as before.
- The commit stage's early check asks the same `commandAllowlist` as the guard.
- `config/queries.json` is back to #263's text on `main`; the store takes it at the next gate (56e4ba1 is the base until a commit carries the trailer). Nothing was re-seeded.
