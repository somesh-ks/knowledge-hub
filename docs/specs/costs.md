# Costs

The cost ledger: what each paid call cost, per run, per timezone and per user. What it does now. Code and tests win where they differ.

## Requirements

### Records
- One `CostRecord` (`packages/core/src/costs.ts`) per provider and product in a run: `at`, `run_id`, `kind` (daily, weekly, catch_up, on_demand, narration_on_play, config, outside_app), `timezone` (the edition's zone, the schedule's for a scheduled run), `user` ("owner" until there are more), `scope`, `stage`, `provider`, `product`, `units` by name, `usd`, and the flags `estimated` and `unpriced`. The id is run, kind, stage, provider, product and user, so recording a run twice keeps one record. A narration billing (each segment, a failed stream and its retry) adds a unique event part to the id, so none overwrites another. `/api/costs` is open (D160) with a 30 a minute limit counted across instances, per instance when the counter is down (D150).
- Scope is the split behind cost per user. A scheduled edition (daily, weekly: fetch, judge, write, narration) is `shared`: everyone in its timezone hears it. An on-demand episode and narration on Play are `user`: they belong to whoever asked. Cost per user is their own records plus an even share of the shared records of their timezone (`costPerUser`); shared cost of a zone with no user is returned as unallocated, never dropped.
- Prices live in `config/prices.json` only: per provider and product (`*` for any), a USD rate per N units, `as_of`, `confirmed` and a note. USD is units times that rate. A unit with no rate adds nothing and sets `unpriced`. Every entry is `confirmed: false` until the owner checks it against the provider's page; the Costs page says so in its note.

### What is measured
- Measured from the response: Anthropic and Gemini input and output tokens (`llm/modelRouter.ts`, per resolved model id; `usageMetadata`), Speechify characters (the engine's `recordUsage`, what the monthly budget counts; the site's usage document, which charges ahead and pessimistically, so Play narration is marked `estimated`).
- Counted by us: Jev and Exa requests (one each; Exa page contents are not billed here), Firecrawl credits (one per request; the response's credit use is not read, so `estimated`).
- Alexandria (product `alexandria`): credits from the response (`creditsCost`); a call that does not report them, or fails, is counted at the capability's stated price and the record is `estimated`.
- Opt a firecrawl source on anthropic.com in to Alexandria `list_posts` (5 credits, scrape on failure) with `source.update` `fetch_via: "alexandria:anthropic-com"`; null clears it.
- Billed (D183): with `ANTHROPIC_ADMIN_KEY` on Vercel, `/api/costs` reads Anthropic's cost report and adds each UTC day's billed total less the ledger's Anthropic records as one `outside_app` record ("Outside the app": the eval, local scripts). It counts no run. Without the key the page's note says that spend is not counted.
- Not tracked: Vercel Blob operations, Vercel function time, GitHub Actions minutes, Exa contents, the podcast's Exa feed fetches.
- A run's counts travel through `.cache/run/spend.json` (`requests` and `units`) and are priced once, at the commit stage (`recordRunCosts`), under the run's first pass kind. A dry run commits its record alone (`chore(costs): dry run`; another change in the tree refuses it), a failed one too (`... failed`, D228). The episode eval (`episode-eval.yml`) records nothing. A ledger failure never fails a run.

### Storage
- Engine records are `state/costs-<YYYY-MM>.json` (month of `at`, UTC), written by `recordPaidCalls` and committed with the run, `singularity publish` (audio) and `singularity podcast`. The write guard allows `state/costs-*.json` for `publish`, `podcast` and `costs` (a dry run's ledger commit, which allows nothing else) (`run` already allows `state/`).
- Site-side spend is the narrate function's existing Blob document `state/usage-<YYYY-MM>.json` (digest, day, characters, repeats); `narrationRecords` turns it into records at read time, so nothing new is stored. The day, not the time, is kept, so such a record is dated noon UTC of its day.
- To record a new paid call from code: `recordPaidCalls(root, [{ at, runId, kind, timezone, stage, provider, product, units, estimated? }])` (`packages/engine/src/cost/ledger.ts`), after adding the product's price to `config/prices.json`. Inside a run, `meter.addUnits(provider, product, unit, n)` on the run's `RequestMeter` and `callsFromSpend` do it for you.

### Reports
- `singularity costs [--period day|week|month] [--from] [--to] [--by provider|kind|timezone|user|product|scope] [--tz] [--json]` totals by period in a zone (default the schedule's) with per-run and per-user averages. A day is the zone's calendar day, so the 25-hour day of a DST change is one bucket. Weeks start Monday.
- Costs (`/admin/costs` in the command center, D224; `/analytics` redirects there) loads `/api/costs` from the reader after first paint (`apps/admin/src/scripts/costsPage.ts`), so the page adds no start-up script. The route merges the build's bundled `state/costs-*.json` (a new ledger commit redeploys the site) with the Blob usage documents; if Blob cannot be read, the page says Play narration is left out. The route takes `period`, `by` and `days`.
- The page is one card (2026-10-22): range and breakdown chips (the shared `.sort-field`: last 30 days, 3 months or 12 months; by provider, use, shared or own, or person once two people share the app), the total as one unlabelled figure (its name is for screen readers; "Estimated spend" came out 2026-10-25), under it stat tiles (`.stat-tiles`: runs, the cost a run and the next figures the data has, a tile each, two columns on a phone and four from 40rem; pills until 2026-10-27) that follow the range and breakdown, one column a day, week or month in the accent colour that grows in from zero on first paint (fade only under reduced motion; the tooltip and the arrow keys give each column's split), then the breakdown largest first, each provider with its mark (`lib/brandMarks.ts`). A table of the periods that spent something sits under it, then "Last updated <date>" (the latest run's day in Stockholm time; the latest bucket's start in week or month view) and the caveat that days follow Swedish time and evals and code reviews are not counted. The head's note reads "Summary of all underlying paid services." A failed load or refetch says "Unavailable" and hides the chart, the breakdown and the table until the next good answer (2026-10-24).
- Anyone who can open the site can read the totals (no passphrase, D160).

## Code
- `packages/core/src/costs.ts`
- `packages/engine/src/cost`
- `packages/engine/src/commands/costs.ts`
- `apps/web/src/server/costs.ts`
- `apps/web/src/server/anthropicBilling.ts`
- `apps/admin/src/pages/costs.astro`
- `config/prices.json`
