# Metrics

How we tell that generation is healthy. Each metric has one definition, one source and one target; `npm run singularity -- metrics` reads them over the newest ten runs and `singularity health` warns when one is off. Targets live in `packages/engine/src/metrics/summary.ts` (`TARGETS`); change them there and here together. A metric is judged only after three runs, so one odd run is never a trend.

## Where the numbers come from

- Briefings: `state/run-metrics.json`, one entry per pass, written in the run's own commit (`run/collectMetrics.ts`). A failed run leaves an entry too, scheduled or on demand, when the job got as far as a plan (`run/recordFailed.ts`).
- Episodes: the `metrics` block of each entry in `state/podcast-timings.json`, written by the publish step.
- Reliability across both workflows: GitHub's run list (`health.yml` passes it to `run_died` and `run_cancelled`).
- Cost: the ledger, `/analytics`.

## The metrics

| Metric | Definition | Target | Why it matters |
| :--- | :--- | :--- | :--- |
| `failure_rate` | Failed briefing runs over runs, newest ten | at most 0.10 | A press that ends in "Stopped while publishing" is the worst outcome |
| `length_share` | Narration aired over the owner's length, median | at least 0.90 | The owner sets 5 minutes and got 2 on 2026-10-27 (0.40) |
| `grounding_survival` | 1 minus stories grounding dropped over stories checked (written plus refilled; a pass that published nothing counts; one with none checked, or no grounder, does not), never below 0, median | at least 0.85 | Dropped stories are paid for and never heard |
| `verified_share` | Published briefings whose every sentence was checked | at least 0.90 | An outage must not pass as verified |
| `model_fallbacks_per_run` | A model replaced by the next in its chain, per run | at most 1 | Settings say Sonnet; a fallback quietly changes who writes |
| `generation_ms` (briefing) | Plan created to generation done | at most 4 min | The owner waits on a Regenerate |
| `script_share` (episode) | Script characters over the length asked, median | at least 0.90 | Catch up asked for 5 minutes and got 3.9 |
| `generation_ms` (episode) | Select, script and publish | at most 3 min | Press to episode |

Also kept per run, not yet judged: the story funnel (`pool`, `written`, `grounding_dropped`, `grounding_pruned`, `validate_dropped`, `refill_written`, `refill_kept`, `aired`), the time of each stage, and for a failure its stage and reason.

## Baseline, 2026-10-27

The Regenerate of that evening (run 40595530256) and the Catch up pressed a minute later (run 40595695646), before the fixes of the same night:

| Metric | Regenerate | Catch up |
| :--- | :--- | :--- |
| Length | 2,117 of 5,330 characters (0.40) | 3,707 of 4,840 (0.77) |
| Stories | 8 written, 4 dropped in grounding, refill failed, 4 aired | 6 chosen, 3 of them celebrity news |
| Time | 3 min 36 s: fetch 17 s, judge 5 s, write 69 s, validate 121 s | select 3 s, script 120 s |
| Outcome | published | failed: push `rebase_conflict` on `state/costs-2026-10.json` |

## Baseline, the six committed digests

Narrated minutes over the owner's length (5 for a daily, 15 for the weekly), from each digest's `audio.json`. This is what `length_share` starts from; the target is 0.90.

| Digest | Stories | Narrated | Share |
| :--- | :--- | :--- | :--- |
| 2026-10-18 weekly | 14 | 5.1 min | 0.34 |
| 2026-10-20 | 10 | 4.0 min | 0.79 |
| 2026-10-22 | 9 | 3.6 min | 0.72 |
| 2026-10-24 | 8 | 3.5 min | 0.70 |
| 2026-10-25 weekly | 20 | 8.1 min | 0.54 |
| 2026-10-27 | 4 | 2.0 min | 0.39 |

Every digest fell short, not only the one that failed: dailies at 0.70 to 0.79, weeklies at 0.34 to 0.54. A story airs at 390 to 530 characters (the sizing assumes 364) and the voice runs 1,015 to 1,077 characters a minute (it assumes 1,066), so the loss is stories, not pace. Nothing has been measured since the fixes of 2026-10-27 to 28: the first three runs after they merge decide `length_share`.

## Speed, measured offline (2026-10-28)

The voice-rewrite step of the write stage, 28 stories (a 5-minute daily with spares) each needing one rewrite, with a fake model that takes a fixed 300 ms a call (a tenth of a real call): main, one story at a time, 8,425 ms; this branch, four at a time, 2,130 ms, 3.96 times faster. At a real 3 s a call that is about 84 s down to 21 s. Grounding runs eight stories at once instead of four (32 Jev requests in flight, as before) and a Catch up skips its 17 s ffmpeg install. What a whole run takes is `generation_ms` after the merge; the baseline is 3 min 36 s for the 10-27 Regenerate and 2 min 5 s for its Catch up.

## Reading them

- `length_share` off: read `funnel` (where did the stories go), then the validate report's `grounding_drops`.
- `generation_ms` off: read `stage_ms`; validate has been the longest stage.
- `failure_rate` off: read `failure` of each failed entry; a push failure is `rebase_conflict` or `rejected` in the run log.
- Nothing is measured until three runs have the metric. `unmeasured` is not a pass.
