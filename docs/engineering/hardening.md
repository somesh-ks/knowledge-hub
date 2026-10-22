# Hardening, 2026-10-21

What fails silently, what watches it now, and what is left. `npm run dispatch -- health` is the
detector; `health.yml` runs it daily, keeps one issue labelled `health` and heals once.
[state.md](../state.md) carries the open items; this file is the map.

## Detectors and self-healing built

| Fault | Detector | Self-healing |
| --- | --- | --- |
| A run failed, or the trigger missed one (D61) | `health`: `run_failed` (a scheduled or weekly job that failed anywhere before Commit records `failed` in run.yml's Record failure step, `run --record-failed`, through the write guard), `run_overdue` | `health.yml` starts one scheduled run when the fault first appears; the `drill` input proves this path on a quiet day (a planted `run_overdue`, one dry run, the issue closed) |
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
| A deploy that never reaches an open or installed app (2026-10-21, D145) | `site_update` (`/sw.js` cacheable, `/build.json` missing); the `serviceWorker.spec.ts` deploy journey | page loads go to the network first (sw.js v13); a page behind the site offers a newer build in a toast with Reload, on load and on return, at most once a minute (D146); without the Popover API the next navigation picks it up |
| A stub story (a summary of a few words) | warning `story_short` (under a third of the writer's minimum) | none: rewrite or regenerate |
| A critical advisory in what ships | CI `check` job: `npm audit --omit=dev --audit-level=critical` | Dependabot PRs |
| Client errors and CSP violations on a phone | `/api/report` logs `[client-fault]` lines (path only, 30 a minute per instance) | none: read the Vercel log |
| A run that died before it recorded an outcome (timeout, an on-demand run, a Record failure step that could not run) | `run_died`: a briefing run of run.yml (named `run`; a dry run and a delete are named for what they are) in GitHub's list (`--runs`, from `gh run list` in `health.yml`) that failed or timed out in the last 3 days with no run record after it started; a `cancelled` one is the warning `run_cancelled` (GitHub reports a job killed at its timeout and the owner's cancel alike); a briefing run under way stands either down only when it is newer | none: an alert only (D146); a missed briefing heals as `run_overdue` |
| A broken episode | `episode_broken`: every Podcasts/ file parses and the shared reader narrates every turn; online, the newest settled episode's first segment has readable word marks once its audio is stored (`episode_unnarrated` warns when it is not stored) | none |
| A config file that stopped parsing | `config_invalid`: doctor's offline config checks, `config/models.json`, and the core schemas of topics, schedule, prices, the catalogue and `sources.user.json` | none |

The self-healing never loops: a retry happens only when no `health` issue is open, so the second
day of the same fault only comments.

## Audit by aspect

**Reliability: scheduled runs and pushes.** Before: a failed or missed run was a line in
`dispatch status` and the run's email; `smoke.yml` asked three API questions. The push retry missed
GitHub's ref-lock race. Gap left: `config.yml` can be cancelled after a 202 (shared group, see the
[reliability audit](reliability-audit-2026-10-15.md)); the Vercel Cron call is never verified
(D61). Added: a `failure()` step in `run.yml` (Record failure) records `failed` for what a
scheduled or weekly run was due to make, so the next `health` reports `run_failed` and heals once
instead of reading the run before; the record is newer than the run, so `run_died` stays quiet for
it. Left: a timeout is a cancel and skips the step (`run_cancelled`, then `run_overdue`).

**Reliability: the site and functions.** Before: `smoke.yml` after each deploy. Added: headers,
`/latest.json` freshness, narration reachability. Gap: function latency and 5xx rates are only in
Vercel's dashboard. Recommend: Vercel log drain or the Observability tab alert on 5xx (cost: plan
dependent; Hobby has none).

**Service worker and offline.** Before: the unit sandbox and the browser suites. The
`vite:preloadError` reload already recovers a tab left across a deploy. Added: the cache-read
heal. Added: the first Download on a page asks for persistent storage (`navigator.storage.persist()`
when `persisted()` is false; fire-and-forget, so a missing API or a refusal never blocks the
download). Gap: where the browser refuses (Chrome decides by engagement, Firefox asks the owner),
quota eviction of downloads is still not detected.

**Performance.** Detector: `checkBundle` holds first load to 130 KB in CI, and since D147 the
weekly lab probe (Mondays, D148) (`scripts/perfProbe.ts` in `health.yml`) loads three pages cold on a throttled
phone and warns `perf_budget` or `perf_unmeasured` on the run's page (no issue). Gap: lab, not field; real-user Web Vitals are
deferred (D147).

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
- Open passphrase (D41): anyone with the URL can start runs inside the caps. Generate, Podcast,
  delete and config count GitHub's run list (or the store), narration the Blob usage document.
  The per-minute caps (topic-emoji's model asks, source-preview's Jev, costs, and a burst cap
  on Generate, Podcast, config and narration) are counted in Neon across instances (D150), with the
  instance's own count as the floor when `DATABASE_URL` is unset or the counter errors or is slow.
  Narration's (40 a minute) is taken after the origin, body and passphrase checks and before the
  store is opened, so a flood past it reads no Blob. Gap: the table exists only after
  `dispatch config seed`.
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

## Round 3: episodes, config, died runs (2026-10-22)

- Web Vitals: built and taken out again before merge (D146); replaced by the weekly lab probe (Mondays, D148) (D147).
- Died runs: GitHub's run list is the start marker. Since then a failed scheduled or weekly job
  records `failed` itself (run.yml's Record failure step), so `run_died` is left to what that step
  cannot record.
- Episodes and config: parsed daily by `health`, with doctor's config checks folded in.

## Coverage by aspect, round 2

Each aspect's detector, where it runs and what heals. Health findings carry `aspect` and `code`, so
`health.yml` keeps one issue for all of them; the heals are per code (see the table above).

| Aspect | Detector | Runs in | Self-heal | Gap |
| --- | --- | --- | --- | --- |
| Reliability | `run_failed`, `run_overdue`, `run_died`, `audio_missing`, `audio_unreachable`, the push answer | `health.yml` daily; every engine push | one run (`run_failed`, `run_overdue`), one `audio.yml`, rebase and retry | Vercel Cron unverified (D61); `run_died` sees run.yml's last 3 days (200 runs at most) and needs `gh` in `health.yml` |
| Availability | `site_down`, `site_api` (`/api/podcast` 405), `site_stale`, `site_update` | `health.yml`; `smoke.yml` after each deploy | none: alert only, a redeploy is the owner's | function 5xx rates and latency (Vercel dashboard only) |
| Stale client | `site_update`; build compare on load and on return to the front; `vite:preloadError` | `health.yml`; every client | network-first page loads, a Reload offer per build, one reload on a missing chunk | a saved page whose assets were pruned still renders unstyled offline |
| Performance | `checkBundle` (D141, 130 KB); the weekly lab probe (Mondays, D148), `perf_budget` and `perf_unmeasured` (D147) | CI build; `health.yml` | none: alert only | lab, not field: one throttled Chromium on a shared runner; real-user Web Vitals deferred (D147) |
| Quality | `digest_thin`, `digest_unverified`, `model_fallback`, `source_failing`, `story_short`, `episode_broken`, `episode_unnarrated` | `health.yml` | none: a thin or stub briefing is the owner's to regenerate | a briefing short of its length; a briefing's own word marks; only the newest episode's first segment is fetched |
| Security | gitleaks, the audit step, `site_headers`, CSP violations to `/api/report`, rate limits | CI; `health.yml`; client | Dependabot | high advisories accepted; CSP violations are log lines with no count; the shared counter needs `dispatch config seed` |
| Cost | `cost_over_ceiling`, `speech_budget`, the per-call caps | `health.yml`; every call | the caps stop the next call | Vercel-side Speechify spend has its own counter |
| Data integrity | `digest_invalid`, `state_invalid`, `config_invalid`, the write guard | `health.yml`; every commit | none: the guard should refuse it | `config/alexandria.json`, `writer.json` and `profiles/` have no core schema to check |
| Offline | `serviceWorker.spec.ts`, the downloads journeys, the cache-read heal | CI `browser` job; every client | caches rebuilt once per worker life; the first Download asks for persistent storage | quota eviction of downloads is not detected where the browser refuses persistence |

Next by value: real-user Web Vitals (its own change, D146), a briefing that aired short
of its length, and function 5xx rates (needs a log drain).
