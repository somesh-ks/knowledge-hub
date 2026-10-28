# Health

The app's health on one page, read live: whether briefings published, how long runs take, how fast pages are for real visitors, what errored, which workflows failed and which services answer. Reasons: D203. The daily check it mirrors: [hardening](../engineering/hardening.md).

## Requirements

- `/settings/health` (D203): a summary card (how many rows need a look, then four stat tiles: last briefing, briefing time, phone page load, errors today) and grouped rows: Briefings (Daily, Weekly, Catch up, Narration, Model fallbacks), Run times, Speed (a Device select, then LCP, INP and CLS p75), Errors (24 hours, the week in each line), Jobs (each workflow's runs this week from GitHub) and Sources and services. Each row: name, a line, its reading at the end with a status dot; the line says what the dot does.
- `GET /api/health` reads the content store (`state/last-run.json`, `state/source-health.json`, the newest 14 briefings), Neon (field vitals, client faults) and GitHub's run list, each part within 4 s, and judges with `singularity health`'s lines (`@singularity/engine/health-limits`). A briefing's time is `generated_at` less `window.to` (its run's start), never the record's `at`, which waits for the publish slot. Open, as every route (D201); 30 a minute across instances; one answer kept 20 s per instance.

## Scenarios

- WHEN a run started ahead publishes an hour later THEN its run time is its generation time, not the wait.
- WHEN a metric has fewer than 20 visits on a device THEN its reading shows with no dot and "Too few to judge".
- WHEN run.yml's hourly ticks skip THEN they are not counted as runs.
- WHEN Neon, GitHub or the content store does not answer THEN only its rows say "Unavailable" (or "Build copy") and the note names it.
