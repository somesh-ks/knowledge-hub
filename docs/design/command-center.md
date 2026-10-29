# Singularity command center: plan

Agreed with Somesh on 2026-10-29 (decisions on the cards in the thread).

## What it is

A separate app in this repo, `apps/admin`, deployed as its own Vercel project (for example `admin.someshks.work`), with its own layout and look. It is not part of the reader: no Settings link, no shared chrome. It is locked with Vercel's own protection (password or login), so no in-app login is needed.

It answers four questions: how is the design system (status), how well is it used (coverage), what does it cost, and is everything healthy. Later: Sentry errors and Google or Simple Analytics.

## Decisions taken

| # | Question | Answer |
|---|---|---|
| 1 | Where does it live | New app in this repo, own deploy (separate repo stays ruled out, D189) |
| 2 | Where does data come from | Phase 1 calls the reader's `/api/costs` and `/api/health`; new sources (Sentry, analytics) get dashboard-only server routes; costs and health move into a shared package later, which lets the reader's public routes be removed |
| 3 | Where do component specs live | Beside each component or stylesheet in `apps/web` (a `*.design.ts` file), changed in the same PR; a test fails when a shared class has no spec |
| 4 | First milestone | Shell plus everything you had: dashboard live and locked with Costs, Health and the current catalogue; the reader loses all admin pages |

## Phases

1. **Shell.** `apps/admin` (Astro, own layout and CSS, a nav for Overview, Design system, Costs, Health), new Vercel project, domain, protection on. The reader's design tokens are reused so the two never drift, but the dashboard's own look is its own (to be shown as screenshots for approval before it merges).
2. **Move what exists.** Costs and Health pages read the reader's APIs. Today's catalogue is ported as is. Then remove `/admin/*`, `/analytics`, `/settings/health`, `/design` and the Settings Admin section from the reader; the old addresses redirect to the dashboard. PR #420 (the same pages under `/admin` in the reader) was closed unmerged.
3. **Design system rebuild.** Pages for colours, typography, design philosophy, tokens (spacing, motion and the rest), and all components in atomic order (atoms, molecules, organisms). Search, categories, per-component pages with controls that flip it between states. Cover thumbnails show the live component reacting to hover and press, not a static image. Needs the `*.design.ts` specs, written for the shared classes and components first.
4. **Coverage analytics.** From the specs and a scan of the app's CSS and markup: which shared classes have a spec, how much of the app uses shared parts instead of one-off rules, which tokens are unused, and a trend over time. The existing `design-check` rules feed it.
5. **Sentry and analytics.** Dashboard-only routes holding their own keys; Sentry errors on Health, Google or Simple Analytics on Overview.

## Risks to watch

- Two deploys: the reader's CI and Vercel config must ignore dashboard-only changes (and the reverse), or every push builds both.
- Importing `apps/web` components and CSS into another app: start with relative imports of leaf files, move to a shared `packages/ui` only when needed.
- Open data routes: until costs and health move into the package, `/api/costs` and `/api/health` stay public on the reader.
- Setup you must do: create the Vercel project and domain, switch on protection, and later create the Sentry project and keys. I cannot do these from here.

## Setup you do (phase 1)

1. Vercel: add a project from this repo with Root Directory `apps/admin` (framework Astro; `apps/admin/vercel.json` sets install, build and ignore rules).
2. Add the domain `admin.someshks.work` to that project.
3. Project Settings, Deployment Protection: protect all deployments including the production domain. Unverified: whether that option is on your Vercel plan; if not, phase 2 needs a small in-app gate instead.

## Left to decide later

- The dashboard's visual language (shown as screenshots in phase 1).
- Whether coverage is a CI gate or a report only.
