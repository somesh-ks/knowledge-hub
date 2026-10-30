# Command center and style guide: plan

Agreed with Somesh on 2026-10-29 (D224). Two apps in this repo, each its own Vercel project, reached on the reader's domain by rewrites.

| App | Address | What it is | Access |
|---|---|---|---|
| `apps/admin` | `news.someshks.work/admin` | The command center: Coverage (design-system use), Costs, Health; later Sentry and Google or Simple Analytics | Owner only: a password gate of its own |
| `apps/design` | `news.someshks.work/design` | The style guide: colour, typography, philosophy, tokens (space, motion), all components in atomic order, search, per-component pages with live state controls, cards whose thumbnails react to hover and press | Open |

Both are drawn with the reader's own stylesheets and shell classes (tokens, foundations, shell, buttons, primitives, settings), so they look like the reader and follow its light and dark theme. A theme chosen in the reader carries over: the apps share its origin.

## How they are reached

Each app sets its path as the Astro `base` (`/admin`, `/design`). The reader's `vercel.json` rewrites `/admin/:path*` to `https://<admin project>/:path*` (the build puts files at the root, the HTML asks for `/admin/...`). The rewrites wait until the projects exist and their addresses are known.

Vercel's deployment protection cannot guard a project that is reached through another project's rewrite, so `/admin` is gated in the app. `middleware.ts` (Vercel Routing Middleware, logic in `src/gate/gate.ts`) sends every address without a session to `/admin/login`, except that page and its assets. The password is `ADMIN_PASSWORD`, the cookie is signed with `ADMIN_SESSION_SECRET` (32 characters or more), 30 days. With either missing the app answers 503 to everything. The Google login replaces the password when it ships. The reader's `/api/costs` and `/api/health` stay public until their code moves into a package.

## Decisions taken

1. Separate apps, not routes in the reader (own bundle, keys and look; separate repo stays ruled out by D189).
2. The command center reads the reader's `/api/costs` and `/api/health` first; new sources get routes of its own; costs and health move into a shared package later, which lets the reader's public routes go.
3. The style guide shows only components the app itself imports (D226), not hand-written specs; each component family is a design-system-only PR that adds its Astro component and its guide page.
4. First milestone: the command center shell, then everything that exists moves in.

## Phases

1. **Command center shell** (PR #421): `apps/admin` with the gate, an Overview that shows the real health and 30-day spend (from the reader's two APIs), and a stub per section, in the reader's language.
2. **Move what exists.** Costs and Health pages in the admin app, reading the reader's APIs, behind the gate; then remove `/analytics`, `/settings/health`, `/design` and Settings' Analytics rows from the reader, redirecting to the new addresses. Needs the rewrites.
3. **Style guide** (`apps/design`), its own thread: colours, typography, tokens, components as the app imports them, a filter on each page.
4. **Coverage analytics:** from the components the app imports and a scan of the app's CSS and markup, which shared parts are components, how much of the app uses them instead of one-off rules, which tokens are unused; the `design-check` rules feed it.
5. **Sentry and analytics:** routes of the admin app that hold their own keys.
6. **Experiments** (`/admin/experiments`): every feature built but not yet trusted, one row each. To add one, add a line to `apps/admin/src/lib/experiments.ts`; a test fails when a flag file or key is gone. A row with a flag has a switch and, while on, Promote; each asks first (the confirm dialog) and offers Undo (the toast). They write Neon's `experiment_flags` through `apps/admin/api/experiments.ts` (behind the same gate; the admin Vercel project needs `DATABASE_URL` and `SINGULARITY_CONFIG_STORE=postgres`), and the next run reads them (D249), so a switch costs no commit and no deploy. The page is drawn from the last deploy's files and the store's switches are laid over it on load; with the store out of reach the controls stay still and the page says so. An entry with no flag (ingest) declares its own state. A shadow row also says what it would have added this week: the write stage saves each pass's count to Neon's `experiment_hits` (kept 7 days, only with the store on), and the same function returns it with the switches; a count the store cannot give leaves the row as it was.

## Design references (Mobbin, 2026-10-29)

- Status: one verdict row first ("All systems operational"), filters in the same row; services as rows with a status dot and a tonal pill; a 30-day strip per service.
- Costs: three headline numbers above one bar chart, a Daily/Weekly/Monthly segmented control in the card header, a table grouped by product with a dot and a right-aligned charge.
- Style guide index: a left category rail with its own search, a 3-column grid of thumbnail cards, category chips; a component page is a three-column layout (nav, preview with code, "on this page"). No reference had state controls, so those are ours.
- Colour and type pages: palette swatches with role names; a type scale as a table with a live sample per row.

## Setup you do

1. Vercel: a project per app from this repo, Root Directory `apps/admin` (and later `apps/design`), framework Astro. Their `vercel.json` sets install, build and ignore rules. Give me each project's production address. For admin also set `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` (a long random string) in the project's environment. After its first deploy, open its address in a private window: it must show the sign-in page, not the Overview.
2. Nothing else until the rewrites go in; then `/admin` and `/design` work on the reader's domain.

## Risks

- Two or three deploys: a reader change under `apps/web/src/styles` or `components` rebuilds the apps (their ignore rules list those paths).
- The apps import the reader's files by relative path; move them to a shared package only if that becomes painful.
- Until costs and health move into a package, `/api/costs` and `/api/health` stay public on the reader.
- The gate is new code and must be built before Costs and Health move.
