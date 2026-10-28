# The Health page

2026-10-28. The owner asked for "a list item to track the health of the app, performance, times, etc. as part of the analytics section in settings", deep in what it tracks and in the same design language.

## What was built

Settings, Analytics, Health opens `/settings/health` ([spec](../specs/health.md), D203): a summary card in the Costs card's shape (how many rows need a look, four stat tiles) and six groups of settings rows: Briefings, Run times, Speed (a device select), Errors, Jobs, Sources and services. Twenty-five readings in all.

## The sources, and what was left out

- `singularity health` already judged most of this, but its report lives in an Actions run. The route reads the same sources live (content store, Neon, GitHub's run list) and the thresholds moved to `healthLimits.ts`, so the page and the daily issue cannot disagree. No workflow changed.
- Run times: the ledger and the run record were tried first and read 96 minutes for a 3 minute run (their `at` waits for the publish slot). A digest's `window.to` is its run's start, so `generated_at` less it is the true time.
- `state/podcast-timings.json` was never committed, so episode stage times are not shown. Cost is on the Costs page, not repeated.
- Left for later: the weekly lab probe's numbers (they live only in a run summary), Blob storage use (the open risk in state), Vercel function latency (Hobby has no API for it).

## Verification

Unit tests for the three traps (publish wait, thin field samples, run.yml's skipped hourly ticks); the page joins the layout, crumb and design sweeps with a frozen answer; screenshots at 390 and 1280, light and dark.

## On production

#393 shipped the page; reading it live found three of its own rows wrong, fixed in #395: Model fallbacks read "No data" for a spend with none (the engine writes the key only when one happens), Catch up read "0 stories" for a run that found nothing, and Jobs, Briefings read Unavailable because run.yml's two pages of runs were fetched one after the other. Since build 3f1cc42 every row answers. The page's first live reading: the 10-27 briefing aired 39% of its length on 3 stories, and Catch up failed twice that week.
