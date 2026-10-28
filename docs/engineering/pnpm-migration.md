# Moving to pnpm: what a spike found, and the steps

2026-10-28, in a scratch worktree of this branch with pnpm 10.28 and Node 24. Not adopted (D205); this is what a later branch needs.

## What worked

- `pnpm import` kept every version of `package-lock.json` (531 packages). A cold-store install took 6 s; `npm ci --ignore-scripts` took 14.5 s with a warm npm cache. The cache states differ, so the two times are two observations, not a like-for-like comparison.
- `astro check` (0 errors), the static build (bundle budget met), the typecheck and all the unit tests (4,960 when the spike ran; the branch has 4,964 since) pass once the changes below are made.

## What had to change

1. `package.json`: `workspaces` becomes `pnpm-workspace.yaml` (`apps/*`, `packages/*`); the workspace dependencies (`"@singularity/core": "*"`) become `workspace:*`.
2. `overrides`: pnpm does not read npm's nested form. `{"@vercel/routing-utils": {"path-to-regexp": "6.3.0"}}` becomes `"pnpm": {"overrides": {"@vercel/routing-utils>path-to-regexp": "6.3.0"}}`, likewise for `@vercel/cli-config>zod`.
3. Lifecycle scripts are off by default: `pnpm.onlyBuiltDependencies` lists `esbuild`, `sharp`, `@parcel/watcher` and `@resvg/resvg-js`.
4. Phantom dependencies, which npm's flat `node_modules` hid: root `scripts/` import `playwright`, `@playwright/test`, `@axe-core/playwright`, `@resvg/resvg-js`, `esbuild` and `@singularity/core` (15 typecheck errors); the web tests import `@electric-sql/pglite` and `linkedom` (2 failing test files). Each needs a declaration where it is used.
5. Scripts that call `npm run ... -w @singularity/web` (`typecheck`, `build`, `dev` in the root `package.json`, `scripts/gate.mjs`) become `pnpm --filter @singularity/web ...`.

## What the spike could not check

- The ten workflows (`npm ci`, `npm run`): they need `pnpm/action-setup` (a new action to pin by SHA), `cache: pnpm`, and the engine-only install of `podcast.yml` as `--filter @singularity/engine...`. Workflow changes need a manual merge, and a failure stops the daily briefing.
- Vercel's `installCommand` in `apps/web/vercel.json`, and its pnpm version (`packageManager` in `package.json`).
- `scripts/worktreeLinks.mjs`, which pnpm's shared store makes unnecessary; AGENTS.md and the runbook name `npm` throughout.
- Dependabot on a pnpm lockfile.
