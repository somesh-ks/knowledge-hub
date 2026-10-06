# Learnings

One line each: symptom, cause, fix. Newest first. Search before debugging.

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
