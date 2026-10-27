# Metrics

How we tell that generation is healthy. Each metric has one definition, one source and one target; `npm run singularity -- metrics` reads them over the newest ten runs and `singularity health` warns when one is off. Targets live in `packages/engine/src/metrics/summary.ts` (`TARGETS`); change them there and here together. A metric is judged only after three runs, so one odd run is never a trend.

## Where the numbers come from

- Briefings: `state/run-metrics.json`, one entry per pass, written in the run's own commit (`run/collectMetrics.ts`). A failed Regenerate or Generate leaves an entry too (`run/recordFailed.ts`).
- Episodes: the `metrics` block of each entry in `state/podcast-timings.json`, written by the publish step.
- Reliability across both workflows: GitHub's run list (`health.yml` passes it to `run_died` and `run_cancelled`).
- Cost: the ledger, `/analytics`.

## The metrics

| Metric | Definition | Target | Why it matters |
| :--- | :--- | :--- | :--- |
| `failure_rate` | Failed briefing runs over runs, newest ten | at most 0.10 | A press that ends in "Stopped while publishing" is the worst outcome |
| `length_share` | Narration aired over the owner's length, median | at least 0.90 | The owner sets 5 minutes and got 2 on 2026-10-27 (0.40) |
| `grounding_survival` | 1 minus stories grounding dropped over stories written, median | at least 0.85 | Dropped stories are paid for and never heard |
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

## Reading them

- `length_share` off: read `funnel` (where did the stories go), then the validate report's `grounding_drops`.
- `generation_ms` off: read `stage_ms`; validate has been the longest stage.
- `failure_rate` off: read `failure` of each failed entry; a push failure is `rebase_conflict` or `rejected` in the run log.
- Nothing is measured until three runs have the metric. `unmeasured` is not a pass.
