# Hardening, 2026-10-21

What fails silently, what watches it now, and what is left. `npm run dispatch -- health` is the
detector; `health.yml` runs it daily, keeps one issue labelled `health` and heals once.
[state.md](../state.md) carries the open items; this file is the map.

## Detectors and self-healing built

| Fault | Detector | Self-healing |
| --- | --- | --- |
| A run failed, or the trigger missed one (D61) | `health`: `run_failed` (a scheduled or weekly job that failed anywhere before Commit records `failed` in run.yml's Record failure step, `run --record-failed`, through the write guard), `run_overdue` | `health.yml` starts one scheduled run when the fault first appears; the `drill` input proves this path whatever real fault is open (`run_overdue` planted on a copy of the report without the real findings, an issue of its own labelled `health-drill`, one dry run, that issue closed; the `health` issue is never read or touched), refused while a run.yml run is under way or when run.yml's own gate says a briefing or the weekly pass is due today (so a real `run_failed` or `run_overdue` holds it back: its dry run would pay for models) |
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
| A high or critical advisory in what ships | CI `check` job: `npm audit --omit=dev --audit-level=high` | Dependabot PRs |
| Client errors and CSP violations on a phone (D158) | `/api/report` logs `[client-fault]` lines (path only, 30 a minute per instance) and keeps each in Neon's `client_faults` for 7 days (route template, the message's start before any quote, digit, new line, `@`, `/` or `www`, at most 60 characters; CSP directive, blocked origin, the raising script's origin or scheme, build; extension-raised ones dropped; 120 rows an hour at most, never failing the beacon); `client_faults` in `health`, warnings only (the endpoint is open, D41, and extensions trip the CSP): 3 or more blocked scripts, or 20 or more client errors on one route (opaque "Script error." aside), in the last 24 hours across builds, named in inline code; an unread faults table warns. A 5xx any `/api` route answers (through `answerWithRef`, or `recordingFaults` for those that answer for themselves, which keep their Response) is kept as kind `server`: route label, the body's step code (`synthesis_failed`) or a throw's start after the log's secret redaction, else `status <n>`, and build; written under `waitUntil`, one a minute per route per instance; `site-icon` and `source-preview` keep only their 500 (their 502 and 504 are the host the caller picked); 3 or more on one route in 24 hours warn | none |
| A page slow or shifting on real phones (D156) | `field_vitals`: each metric's 7-day p75 from real visits (`/api/report` kind `vitals` into Neon's `web_vitals`), per device class, a warning past Google's "needs improvement" line, a fault past "poor"; `field_unmeasured` when phones gave under 20 samples of a metric in the week, `DATABASE_URL` is unset or the vitals query alone fails (no connection is `store_degraded`) | none: the fault opens the `health` issue, nothing heals |
| A run that died before it recorded an outcome (timeout, an on-demand run, a Record failure step that could not run) | `run_died`: a briefing run of run.yml (named `run`; a dry run and a delete are named for what they are) in GitHub's list (`--runs`, from `gh run list` in `health.yml`) that failed or timed out in the last 3 days with no run record after it started; a `cancelled` one is the warning `run_cancelled` (GitHub reports a job killed at its timeout and the owner's cancel alike); a briefing run under way stands either down only when it is newer | none: an alert only (D146); a missed briefing heals as `run_overdue` |
| A broken episode | `episode_broken`: every Podcasts/ file parses and the shared reader narrates every turn; online, the newest settled episode's first segment has readable word marks once its audio is stored (`episode_unnarrated` warns when it is not stored) | none |
| A config file that stopped parsing | `config_invalid`: doctor's offline config checks, `config/models.json`, and the core schemas of topics, schedule, prices, the catalogue and `sources.user.json` | none |
| Neon unreachable (the site falls back to per-instance caps and drops vitals, silently) | warning `store_degraded`: with `DATABASE_URL` set, health's own connection or the rate counter's check fails (Neon may be waking, so not a fault); a missing `rate_limit_counters` is no finding; `field_unmeasured` stays the warning for no `DATABASE_URL` and thin samples | `takeSharedSlot` creates the table on its first request (42P01), as the vitals store does |
| An owner edit in the config store that runs skip or never commit (D149) | with `DISPATCH_CONFIG_STORE=postgres`, only `CONFIG_DOCUMENT_PATHS`: `config_store_drift` faults a stored document not JSON or failing its core schema, and warns when one differs from the committed file though it was written before the last run record that is not a failure (that `at` is the commit, after the copy, so an edit during a run reads the same: a fault needs the copy time in the record); `config_store_unread` faults when the documents do not read (runs then keep the committed files) | none |
| A deploy Vercel skipped (since D157 the `ignoreCommand` diffs from `VERCEL_GIT_PREVIOUS_SHA`, the last deployed commit, else `HEAD^`; an unknown commit errors, so Vercel builds) | warning `site_behind`: `/build.json`'s commit does not hold the newest non-bot commit on `origin/main` (else `main`) touching a path `apps/web/vercel.json`'s `ignoreCommand` watches, 45 minutes on; a build git does not know, or a name with no a-f letter (a start time), is no finding (`health.yml` fetches 100 commits) | none |
| Warnings nobody sees (no issue) | Mondays: one issue labelled `health-warnings` lists the standing warnings, closed when none remain; an open `health` issue's daily comment leads with faults new since the last one | none |
| Site narration spend | `speech_budget` adds the site's own month count (`state/usage-<month>.json` on Blob, read past the CDN, online); unreadable or holding another month is the warning `site_usage_unread`; not in `cost_over_ceiling` (its records are per day) | none |

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
phone and warns `perf_budget` or `perf_unmeasured` on the run's page (no issue). Since D156 real
visits are judged too: a lazy module (`apps/web/src/scripts/vitals.ts`, loaded at idle or at the
first hide, with D154's opt-outs; its loader is all the first load carries) sends one beacon per
page load with LCP, INP and CLS, the route template, the device class and the connection type;
`/api/report` stores it in Neon (`web_vitals`, 7 days, 600 rows an hour at most, never failing the
beacon), and `health` reads it daily: `field_vitals` warns at "needs improvement" and faults at
"poor" on a 7-day p75, `field_unmeasured` warns on too few phone samples. Gap: one report per page
load at its first hide, so a resumed installed app's later presses are not counted; forged beacons
can move a p75 (the endpoint is open, D41), at most 600 rows an hour.

**Quality of briefings.** Before: the validate stage grounds each story with Jev and drops the
ungrounded; nothing reported a thin run after the fact. Added: `digest_thin`,
`digest_unverified`, `model_fallback`, and `episode_short` for one that aired short of its length.

**Narration.** Before: `audio.yml` after each run and the retry path in the commit stage. Added:
`audio_missing` with one heal, `audio_unreachable`. Gap: episodes (Podcasts/) are not checked.

**Security.**
- CSP: Astro's meta policy (script hashes) plus the `vercel.json` header policy. Violations now
  reach `/api/report` through the `securitypolicyviolation` event (a meta policy cannot carry
  `report-uri`), and are kept a week in Neon: 3 or more blocked scripts in 24 hours are the
  `client_faults` warning (D158; never a fault, since a report can be forged).
- Headers: HSTS added (`max-age=63072000; includeSubDomains`); `health` faults a missing one.
- Open passphrase (D41): anyone with the URL can start runs inside the caps. Generate, Podcast,
  delete and config count GitHub's run list (or the store), narration the Blob usage document.
  The per-minute caps (topic-emoji's model asks, source-preview's Jev, costs, and a burst cap
  on Generate, Podcast, config and narration) are counted in Neon across instances (D150), with
  the instance's own count as the floor when `DATABASE_URL` is unset or the counter errors or is
  slow. Gap: with the passphrase off anyone can
  fill a burst cap's minute, which for narration fails the owner's next turn until it ends. The
  table is now created on first use; `store_degraded` warns when Neon does not answer.
- SSRF: `source-preview` and `site-icon` check every resolved address and redirect hop. Known gap
  (documented there): DNS rebinding between check and connect.
- Secrets: gitleaks in CI; the logger redacts key values; `/api/report` keeps paths only.
- Dependencies: `npm audit` high for `vite` 8.3.2 (dev server; now 8.3.3 in the lockfile) and
  `path-to-regexp` under `@astrojs/vercel` (build-time routing). The root `overrides` holds
  `@vercel/routing-utils`' `path-to-regexp` at 6.3.0 (patched, same major) over its exact pin
  of 6.1.0 (D151). The emitted routes (`.vercel/output/config.json`) and function configs were
  identical before and after, but the library's own diff warning between the two versions is now
  silent: diff `config.json` after a change to `vercel.json`'s sources. CI fails on a high
  advisory (`--audit-level=high`). Drop the override once routing-utils pins a patched version.
  Dependabot PRs auto-merge.

**Cost.** Before: the ledger and `dispatch costs`, the Speechify 90% stop, Firecrawl's ceiling.
Added: a daily ceiling fault; health adds the site's own Speechify month count to the allowance.
Gap: the site's records are per day, so its narration is not in the 24-hour ceiling.

**Left out (round 4, 2026-10-22).** A site-side probe of the store (health reads Neon itself);
a late-briefing check (built and removed: Vercel Cron starts the on-time briefing as a
`workflow_dispatch` (D61) and run.yml makes skipped hourly `schedule` runs, so neither the run list
nor the state can tell late from on time or from a regenerate; it needs the trigger recorded in
the run record); phones under GPC
never report vitals, so `field_unmeasured` may warn for good.

**Accessibility.** Detector: axe in the browser suites. Gap: no check on production. Recommend:
one axe pass of the home page in `health.yml` with Playwright (medium; adds a browser install).

**Data integrity.** Before: the write guard (allowlists per command, digest edits limited to
audio). Added: every digest and state file must parse, daily. Gap: Podcasts/ files and
`config/` are not parsed by `health`; `doctor` checks config. Recommend: fold `doctor`'s offline
config checks into `health` (small).

## Round 3: episodes, config, died runs (2026-10-22)

- Web Vitals: built and taken out again before merge (D146); replaced by the weekly lab probe (Mondays, D148) (D147); field Web Vitals in Neon beside it since D156.
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
| Availability | `site_down`, `site_api` (`/api/podcast` 405), `site_stale`, `site_update`, a run of client errors, or of 5xx answered through `answerWithRef` (3 or more on one route), in 24 hours (`client_faults`, a warning) | `health.yml`; `smoke.yml` after each deploy | none: alert only, a redeploy is the owner's | handled 5xx kept (`client_faults`, kind `server`, every `/api` route through `answerWithRef` or `recordingFaults`); a stream that fails after its headers went out, and timeouts and crashes Vercel kills, are not seen and still need a log drain; latency only in the Vercel dashboard |
| Stale client | `site_update`; build compare on load and on return to the front; `vite:preloadError` | `health.yml`; every client | network-first page loads, a Reload offer per build, one reload on a missing chunk | a saved page whose assets were pruned still renders unstyled offline |
| Performance | `checkBundle` (D141, 130 KB); the weekly lab probe (Mondays, D148), `perf_budget` and `perf_unmeasured` (D147); field Web Vitals, `field_vitals` and `field_unmeasured` (D156) | CI build; `health.yml` (the probe on Mondays, the field p75 daily) | none: alert only (a poor field p75 opens the issue) | the lab is one throttled Chromium on a shared runner; the field counts a page load once, at its first hide, and an open endpoint can forge samples |
| Quality | `digest_thin`, `digest_unverified`, `model_fallback`, `source_failing`, `story_short`, `episode_broken`, `episode_unnarrated` | `health.yml` | none: a thin or stub briefing is the owner's to regenerate | a briefing's own word marks; only the newest episode's first segment is fetched |
| Security | gitleaks, the audit step, `site_headers`, CSP violations kept a week (`client_faults`), rate limits | CI; `health.yml`; client | Dependabot | the path-to-regexp override must follow upstream; a fault report carries the build its bundle loaded with (read once, since in-app moves swap the head meta), so a tab open across deploys reports under its old one |
| Cost | `cost_over_ceiling`, `speech_budget` (engine and site month counts), the per-call caps | `health.yml`; every call | the caps stop the next call | the site's narration is not in the 24-hour ceiling |
| Deploys | the Vercel status on each commit; `site_stale` when production lags the newest digest | GitHub; `health.yml` | only `main` and `preview/*` deploy (`vercel.json`); `branches.yml` deletes closed branches daily and trims Neon preview branches to two | Neon trimming needs `NEON_API_KEY` and `NEON_PROJECT_ID`; a failed preview shows only on its pull request |
| Data integrity | `digest_invalid`, `state_invalid`, `config_invalid`, the write guard | `health.yml`; every commit | none: the guard should refuse it | `config/alexandria.json`, `writer.json` and `profiles/` have no core schema to check |
| Offline | `serviceWorker.spec.ts`, the downloads journeys, the cache-read heal | CI `browser` job; every client | caches rebuilt once per worker life; the first Download asks for persistent storage | quota eviction of downloads is not detected where the browser refuses persistence |

Next by value: function timeouts and crashes, which never reach `answerWithRef` (needs a log drain).
