# Content as data: builds for code only

The owner's direction of 2026-10-24: "I want the app to access everything from the database as content repository always, the builds only happen for app improvements and feature builds. the same with settings, sources, etc." D173 records it. This doc is the plan; code and tests win where they differ once it is built.

## Where the deploys come from today

Vercel builds `main` on every push that touches a path in `ignoreCommand` (`apps/web/vercel.json`): `Digests/`, `Podcasts/`, `config/`, three `state/` files and the code. So a run deploys twice (digest, then narration metadata), an episode twice (file, then narration), and a config snapshot once. Every page, cover, `/latest.json` and the search index is built from those files.

## The model

- **Content lives in Vercel Blob, the content store.** Blob is served from the CDN, so a read has no cold start; Neon's free tier sleeps, which is why it does not hold what every page load reads.
- **Settings and sources live in Neon** (D149, on since 2026-10-24), read at run time with the device's copy in front (D172).
- **Git is the backup, not the source.** The engine still commits what it writes, for history and recovery, and those commits stop deploying (step 4).
- **The build ships code only.** Pages that show content are rendered on request from the store, with a short shared cache (`s-maxage=60, stale-while-revalidate`) so a visit seldom waits on a function and new content shows within a minute. A page arrives with its content in the HTML, as today; no page becomes a script that fetches its own content.
- **One content repository.** Every content read goes through one module (`server/contentRepo.ts`: get a briefing, list briefings, get an episode, list episodes, the last run). No page reads Blob or the disk itself. Today it reads Blob. With many users (the owner, 2026-10-24: "this needs to be scaled for the future when we have many more users") it reads Postgres with a user id on each row, and no page changes: Blob files cannot be queried per user, and an edge cache keyed by URL cannot hold a personal page.

## The content store

`dispatch content sync` (`engine/src/publish/contentSync.ts`) mirrors the repository's content into the store under `content/<repository path>`: every file under `Digests/` and `Podcasts/`, and `state/last-run.json`, `source-stats.json` and `source-candidates.json`. It compares the checkout with `content/manifest.json` (each path and its SHA-256), sends what changed, deletes what is gone and writes the manifest last, so a sync that dies half way is finished by the next. `content.yml` runs it after every `run`, `podcast`, `audio` and `config` workflow (`workflow_run`: a push with the Actions token starts no workflow), and by hand to fill the store. `episodes/index.json` (PR #252) is rewritten when an episode changes.

The files keep the repository's format, so the site reads them with the parsers it already has (`readDigestFiles`, `parseEpisodeFile`, `readLastRun`), pointed at the store instead of the disk.

## The pages

- **Home, Library, a briefing (`/d/<id>`), an episode (`/e/<id>`), `/latest.json`, the search index:** rendered on request through the content repository, with the short shared cache.
- **Covers:** the build draws what it holds; after each sync `apps/web/scripts/storeCovers.ts` draws, once per id, the covers of the store's content into `content/covers/` (eight files an id), and a `vercel.json` rewrite sends a `/covers/` request the build cannot answer there.
- **`/api/narrate`, `/api/narrate-marks`, `/api/generate`, `/api/podcast`** read briefings, timelines and episodes through `server/contentSources.ts`: the store first, the bundle when the store cannot answer or lacks the file.
- **Offline:** the service worker keeps the pages it has served, as today.

## Settings and sources

The pages are already built shells with the store laid over them (D149, D166, D172), and a new topic opens a shell before any build (D142). What remains: the run's `config/` snapshot commit stops deploying (step 4), and every settings screen is checked to read the store, not only its built copy.

## Order

Each step ships alone and leaves production working.

1. **The engine fills the content store** (`dispatch content sync`, `content.yml`). Nothing reads it yet.
2. **The content repository and one page:** `server/contentRepo.ts` over the store, and `/d/<id>` rendered on request through it, on a preview deploy. It settles the function's cold start and the cache header before the rest moves.
3. **The other pages and `/api/narrate` read the store.** A page the store cannot answer returns 503 with `Retry-After` (the function carries no content to fall back on); within the ten-minute stale window the edge serves its last copy instead.
4. **Settings and sources:** check every screen reads the store, not only its built copy.
5. **The switch.** `ignoreCommand` watches code only (`apps/web`, `packages`, `tokens`, `scripts`, the package files). From then on a run, an episode or a save never deploys. The owner approves this step before it merges.

## Health

`dispatch health` and the smoke check (D159) gain rows: each index parses; every id an index names has its file and covers; the newest briefing in the store matches the newest in git. `site_behind` keeps watching code deploys only.

## What it costs

- A request the shared cache cannot answer renders on a function (a cold start, about a second); within the cache window a visit is served from the edge as a static page is.
- Pages depend on a running function and a reachable store, the part that broke in #152; the smoke check (#154) covers the function.
- Blob operations: a few writes a sync and one read a render, inside the Hobby allowance at one user's volume.

## Built so far

- `episodes/index.json` (PR #252).
- `dispatch content sync` and `content.yml` (step 1).
- `server/contentRepo.ts` and `/d/<id>` on request (step 2, PR #259).
- Home, Library, `/latest.json` and the search index on request (step 3, PR #264).
- `/e/<id>` on request, store covers, the API routes on the store (step 3, rest).
- Step 4, settings: the cost ledger and price table (PR #269); Play's voice from the stored schedule (PR #271); the Create panel (voices, format, length, topics) and the Daily, Weekly and Regenerate topic chips laid over from the store, which now passes on Create's voices. The Sources list and topic pages show stored sources, moves, formats, leans, new topics in the panels and renames; a store answer that comes after a page is drawn offers a reload. Not covered: a renamed topic's generated picture, drawn at build.
