# Costs

The cost ledger: what each paid call cost, per run, per timezone and per user. What it does now. Code and tests win where they differ.

## Requirements

### Records
- One `CostRecord` (`packages/core/src/costs.ts`) per provider and product in a run: `at`, `run_id`, `kind` (daily, weekly, catch_up, on_demand, narration_on_play, config), `timezone` (the edition's zone, the schedule's for a scheduled run), `user` ("owner" until there are more), `scope`, `stage`, `provider`, `product`, `units` by name, `usd`, and the flags `estimated` and `unpriced`. The id is run, kind, stage, provider, product and user, so recording a run twice keeps one record.
- Scope is the split behind cost per user. A scheduled edition (daily, weekly: fetch, judge, write, narration) is `shared`: everyone in its timezone hears it. An on-demand episode and narration on Play are `user`: they belong to whoever asked. Cost per user is their own records plus an even share of the shared records of their timezone (`costPerUser`); shared cost of a zone with no user is returned as unallocated, never dropped.
- Prices live in `config/prices.json` only: per provider and product (`*` for any), a USD rate per N units, `as_of`, `confirmed` and a note. USD is units times that rate. A unit with no rate adds nothing and sets `unpriced`. Every entry is `confirmed: false` until the owner checks it against the provider's page; the Costs page lists them.

### What is measured
- Measured from the response: Anthropic and Gemini input and output tokens (`llm/modelRouter.ts`, per resolved model id; `usageMetadata`), Speechify characters (the engine's `recordUsage`, what the monthly budget counts; the site's usage document, which charges ahead and pessimistically, so Play narration is marked `estimated`).
- Counted by us: Jev and Exa requests (one each; Exa page contents are not billed here), Firecrawl credits (one per request; the response's credit use is not read, so `estimated`).
- Alexandria (product `alexandria`): credits from the response (`creditsCost`); a call that does not report them, or fails, is counted at the capability's stated price and the record is `estimated`.
- Not tracked: Vercel Blob operations, Vercel function time, GitHub Actions minutes, Exa contents, the podcast's Exa feed fetches.
- A run's counts travel through `.cache/run/spend.json` (`requests` and `units`) and are priced once, at the commit stage (`recordRunCosts`), under the run's first pass kind. A ledger failure never fails a run.

### Storage
- Engine records are `state/costs-<YYYY-MM>.json` (month of `at`, UTC), written by `recordPaidCalls` and committed with the run, `dispatch publish` (audio) and `dispatch podcast`. The write guard allows `state/costs-*.json` for `publish` and `podcast` (`run` already allows `state/`).
- Site-side spend is the narrate function's existing Blob document `state/usage-<YYYY-MM>.json` (digest, day, characters, repeats); `narrationRecords` turns it into records at read time, so nothing new is stored. The day, not the time, is kept, so such a record is dated noon UTC of its day.
- To record a new paid call from code: `recordPaidCalls(root, [{ at, runId, kind, timezone, stage, provider, product, units, estimated? }])` (`packages/engine/src/cost/ledger.ts`), after adding the product's price to `config/prices.json`. Inside a run, `meter.addUnits(provider, product, unit, n)` on the run's `RequestMeter` and `callsFromSpend` do it for you.

### Reports
- `dispatch costs [--period day|week|month] [--from] [--to] [--by provider|kind|timezone|user|product|scope] [--tz] [--json]` totals by period in a zone (default the schedule's) with per-run and per-user averages. A day is the zone's calendar day, so the 25-hour day of a DST change is one bucket. Weeks start Monday.
- Analytics (`/analytics`, a row on the Settings index) loads `/api/costs` after first paint (`apps/web/src/scripts/costsPage.ts`), so the page adds no start-up script. The route merges the build's bundled `state/costs-*.json` (a new ledger commit redeploys the site) with the Blob usage documents; if Blob cannot be read, the page says Play narration is left out. It shows the last 30 days; the route also takes `period`, `by` and `days`.
- The route has no passphrase (D41): anyone who can open the site can read the totals.

## Code
- `packages/core/src/costs.ts`
- `packages/engine/src/cost`
- `packages/engine/src/commands/costs.ts`
- `apps/web/src/server/costs.ts`
- `apps/web/src/pages/analytics.astro`
- `config/prices.json`
