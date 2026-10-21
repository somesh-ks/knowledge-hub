# Hardening, 2026-10-21

What fails silently, what watches it now, and what is left. `npm run dispatch -- health` is the
detector; `health.yml` runs it daily, keeps one issue labelled `health` and heals once.
[state.md](../state.md) carries the open items; this file is the map.

## Detectors and self-healing built

| Fault | Detector | Self-healing |
| --- | --- | --- |
| A run failed, or the trigger missed one (D61) | `health`: `run_failed`, `run_overdue` | `health.yml` starts one scheduled run when the fault first appears |
| Narration missing a day later | `audio_missing` | one `audio.yml` run (narrates every digest without audio) |
| Narration file gone from Blob | `audio_unreachable` (HEAD of the newest file) | none: re-run `publish` |
| A digest or state file that does not parse | `digest_invalid`, `state_invalid` | none: the guard should have refused it |
| Thin or unverified briefing, model fallbacks, failing sources | warnings `digest_thin` (under 5), `digest_unverified`, `model_fallback`, `source_failing` | none |
| Runaway spend | `cost_over_ceiling` (ledger, last 24 h, `DISPATCH_DAILY_USD_CEILING`, default $5), `speech_budget` | none: the caps stop the next call |
| Vercel skipped a deploy (Hobby author check, failed build) | `site_stale`: `/latest.json` behind the newest digest by 45 min | none |
| Lost security headers, functions down | `site_headers`, `site_api`, `site_down` | none |
| Two pushes in one instant (2026-10-21 episode delete) | the push answer | `commitAndPush` now reads a ref-lock race as a rejection and rebases (every engine push uses it) |
| A cache entry the browser broke | the worker's strategy rejects | `sw.js` (v12) answers from the network and rebuilds its caches once |
| A stop waiting on a device for weeks | `splitStaleBlocks` | dropped after 7 days with a toast |
| A deploy that never reaches an open or installed app (2026-10-21, D145) | `site_update` (`/sw.js` cacheable, `/build.json` missing); the `serviceWorker.spec.ts` deploy journey | page loads go to the network first (sw.js v13); an app back at the front reloads once to a newer build |
| A stub story (a summary of a few words) | warning `story_short` (under a third of the writer's minimum) | none: rewrite or regenerate |
| A critical advisory in what ships | CI `secrets` job: `npm audit --omit=dev --audit-level=critical` | Dependabot PRs |
| Client errors and CSP violations on a phone | `/api/report` logs `[client-fault]` lines (path only, 30 a minute per instance) | none: read the Vercel log |

The self-healing never loops: a retry happens only when no `health` issue is open, so the second
day of the same fault only comments.

## Audit by aspect

**Reliability: scheduled runs and pushes.** Before: a failed or missed run was a line in
`dispatch status` and the run's email; `smoke.yml` asked three API questions. The push retry missed
GitHub's ref-lock race. Gap left: `config.yml` can be cancelled after a 202 (shared group, see the
[reliability audit](reliability-audit-2026-10-15.md)); the Vercel Cron call is never verified
(D61); `health` only sees the run's recorded outcome, so a run that died before Commit reads as the
previous one (caught later by `run_overdue`). Recommend: a `failure()` step in `run.yml` that
records `failed` (small; a workflow change).

**Reliability: the site and functions.** Before: `smoke.yml` after each deploy. Added: headers,
`/latest.json` freshness, narration reachability. Gap: function latency and 5xx rates are only in
Vercel's dashboard. Recommend: Vercel log drain or the Observability tab alert on 5xx (cost: plan
dependent; Hobby has none).

**Service worker and offline.** Before: the unit sandbox and the browser suites. The
`vite:preloadError` reload already recovers a tab left across a deploy. Added: the cache-read
heal. Gap: quota eviction of downloads is not detected. Recommend: `navigator.storage.persist()`
on the first Download (small).

**Performance.** Detector: `checkBundle` holds first load to 109 KB (heaviest page about
108.7 KB; the reporter added a few hundred bytes to `app.ts`). Gap: no LCP or INP from real
devices. Recommend: send `PerformanceObserver` LCP and INP through `/api/report` at page hide
(about 0.3 KB, needs budget room from a cut in [first-load-js.md](first-load-js.md)); Vercel
Speed Insights costs about 4 KB and money.

**Quality of briefings.** Before: the validate stage grounds each story with Jev and drops the
ungrounded; nothing reported a thin run after the fact. Added: `digest_thin`,
`digest_unverified`, `model_fallback`. Gap: a briefing that aired well short of its length.
Recommend: record the sized target in the digest and compare (medium).

**Narration.** Before: `audio.yml` after each run and the retry path in the commit stage. Added:
`audio_missing` with one heal, `audio_unreachable`. Gap: episodes (Podcasts/) are not checked.

**Security.**
- CSP: Astro's meta policy (script hashes) plus the `vercel.json` header policy. Violations now
  reach `/api/report` through the `securitypolicyviolation` event (a meta policy cannot carry
  `report-uri`).
- Headers: HSTS added (`max-age=63072000; includeSubDomains`); `health` faults a missing one.
- Open passphrase (D41): anyone with the URL can start runs inside the caps. Caps exist for
  Generate, Podcast, delete, narration and config; `/api/topic-emoji` had none and now asks Jev
  at most 20 times a minute per instance. Gap: per-instance limits reset on a cold start.
  Recommend: re-enable the passphrase, or a KV counter (Upstash, free tier) for the paid routes.
- SSRF: `source-preview` and `site-icon` check every resolved address and redirect hop. Known gap
  (documented there): DNS rebinding between check and connect.
- Secrets: gitleaks in CI; the logger redacts key values; `/api/report` keeps paths only.
- Dependencies: `npm audit` high for `vite` 8.3.2 (dev server; now 8.3.3 in the lockfile) and
  `path-to-regexp` under `@astrojs/vercel` (build-time routing; the fix is a major, not taken).
  Dependabot PRs auto-merge. Recommend: `npm audit --omit=dev --audit-level=high` in CI (small).

**Cost.** Before: the ledger and `dispatch costs`, the Speechify 90% stop, Firecrawl's ceiling.
Added: a daily ceiling fault. Gap: Vercel-side Speechify spend has its own counter (Known risks).

**Accessibility.** Detector: axe in the browser suites. Gap: no check on production. Recommend:
one axe pass of the home page in `health.yml` with Playwright (medium; adds a browser install).

**Data integrity.** Before: the write guard (allowlists per command, digest edits limited to
audio). Added: every digest and state file must parse, daily. Gap: Podcasts/ files and
`config/` are not parsed by `health`; `doctor` checks config. Recommend: fold `doctor`'s offline
config checks into `health` (small).

## Coverage by aspect, round 2

Each aspect's detector, where it runs and what heals. Health findings carry `aspect` and `code`, so
`health.yml` keeps one issue for all of them; the heals are per code (see the table above).

| Aspect | Detector | Runs in | Self-heal | Gap |
| --- | --- | --- | --- | --- |
| Reliability | `run_failed`, `run_overdue`, `audio_missing`, `audio_unreachable`, the push answer | `health.yml` daily; every engine push | one run, one `audio.yml`, rebase and retry | a run that dies before Commit; Vercel Cron unverified (D61) |
| Availability | `site_down`, `site_api` (`/api/podcast` 405), `site_stale`, `site_update` | `health.yml`; `smoke.yml` after each deploy | none: alert only, a redeploy is the owner's | function 5xx rates and latency (Vercel dashboard only) |
| Stale client | `site_update`; build compare on return to the front; `vite:preloadError` | `health.yml`; every client | network-first page loads, one reload per build, one reload on a missing chunk | a saved page whose assets were pruned still renders unstyled offline |
| Performance | `checkBundle` (D141, 130 KB) | CI build | none | **no real-user LCP, INP or CLS**: send them through `/api/report` at page hide, sampled, and have `health` read them (needs a log store: Vercel logs are not queryable from `health`) |
| Quality | `digest_thin`, `digest_unverified`, `model_fallback`, `source_failing`, `story_short` | `health.yml` | none: a thin or stub briefing is the owner's to regenerate | an episode (Podcasts/) is not checked; a briefing short of its length; word marks missing |
| Security | gitleaks, the audit step, `site_headers`, CSP violations to `/api/report`, rate limits | CI; `health.yml`; client | Dependabot | high advisories accepted; CSP violations are log lines with no count; per-instance limits reset on a cold start |
| Cost | `cost_over_ceiling`, `speech_budget`, the per-call caps | `health.yml`; every call | the caps stop the next call | Vercel-side Speechify spend has its own counter |
| Data integrity | `digest_invalid`, `state_invalid`, the write guard | `health.yml`; every commit | none: the guard should refuse it | Podcasts/ and `config/` not parsed by `health` |
| Offline | `serviceWorker.spec.ts`, the downloads journeys, the cache-read heal | CI `browser` job; every client | caches rebuilt once per worker life | quota eviction of downloads is not detected |

Next by value: real-user Web Vitals (the budget now has room), `config/` and Podcasts/ parsed by
`health`, and a `failure()` step in `run.yml` that records a failed run.
