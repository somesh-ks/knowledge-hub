# Learnings

One line each: symptom, cause, fix. Newest first. Search before debugging.

- A function's budget counter could lose counts: `@vercel/blob` honours `useCache: false` only for private stores, and this store is public, so a state read could be a minute stale. Read mutable state with `head()` and then the URL plus a version query built from what `head` returned.
- Vercel Hobby includes 2,000 advanced Blob operations a month (`put`, `copy`, `list`) and 10,000 simple ones (`head`, a read that misses the cache); going over locks the store for 30 days. Count operations per call when designing anything that writes to Blob, and never `list` on a page view.
- The live Play control never changed to Pause: the page rendered `.cta-label` while `readerSync` wrote to `[data-play-label]`, and every player test ran against the dev lab page, which had the right hooks. Test the contract between markup and script on a real built page.
- The disk filled (0 bytes free) when two agents each ran `npm ci` in their own worktree. Give a worktree junctions into the main `node_modules` instead, and never install inside one.
- `npm run lint` fails inside a worktree under `.claude/`: `biome.json` ignores `**/.claude`, so Biome ignores `.` there. Run `npx biome check apps packages scripts tokens` in the worktree and the full lint from the main checkout.
- An inline `node -e` or heredoc script lost its backslashes in the agent shell (a regex `/\/+$/` arrived as `//+$/`). Write any script that contains a backslash to a file first.

- Blob upload failed with "OIDC is enabled for this project, but not for the development environment": the CLI pull issues a development OIDC token and the store was connected to Production and Preview only. Connect the store to Development too (dashboard, Storage, store, connected project, environments).
- `audio.yml` failed at the write guard ("changes outside the publish allowlist: .gitignore"): `vercel link` and `vercel env pull` edit `.gitignore` and write `.vercel`; run them in a scratch directory outside the checkout.
- `vercel env pull` writes the text `[SENSITIVE]` for hidden secrets, so `BLOB_READ_WRITE_TOKEN` would load as that string and beat the OIDC credentials; `loadEnv` now treats it as unset.
- Doctor said voice `geffen_32` was missing: Speechify `GET /v1/voices` is cursor-paged (50 by default, 200 at most); follow `next_cursor` while `has_more` is true.
- Green tests did not catch the audio failure: nothing exercises the live Vercel, Speechify and Blob path. Run `dispatch doctor --online` after any credential change.
- First `audio.yml` run (2026-10-06) failed at `vercel link` with "User not found (404)": the `VERCEL_TOKEN` secret is invalid or the wrong kind. Replace it with a fresh account token from the dashboard, then rerun the workflow.
- Run failed at Commit with a change outside the write allowlist: `npm ci` marks `packages/engine/src/cli.ts` (a `bin` target) executable. Track it as 100755.
- Vercel Hobby blocks deploys of bot-authored commits: only the team owner's commits deploy. Engine commits as `DISPATCH_GIT_NAME` and `DISPATCH_GIT_EMAIL` (D25).
- Vercel Blob token cannot be copied: it is sensitive and hidden after creation; use OIDC credentials (D26).
- `vercel tokens create --project` fails on Hobby ("Cannot create tokens for this app"): create an account token in the dashboard.
- The Vercel CLI appends `.env*` to `.gitignore`, which would ignore `.env.example`. Revert it before committing.
- `vercel env add` failed when run from `apps/web` but the project was linked at the root: `secrets:push` now uses whichever directory has `.vercel/project.json`.
- gitleaks needs `pull-requests: read` on pull requests.
- Biome lints Playwright `test-results`; excluded in `biome.json`.
- Stylesheet test assumed the layout imports every CSS file; islands import `player.css` too.
- Write step skipped the grounding check because `TYPESAFE_API_KEY` was missing from its env.
- `astro check` crashes on TypeScript 7: pinned to 6.x (D19). Dependabot ignores major versions.
- Local Windows builds of the Vercel adapter fail on symlinks: use `DISPATCH_STATIC_ONLY=1`.
- Nebius model ids change; take them from `dispatch models`, not docs (D24).
- Auto-mode classifier blocks credential creation, store deletion and merging unreviewed PRs; the owner runs those.
