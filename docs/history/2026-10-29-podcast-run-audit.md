# 2026-10-29: podcast run audit

Somesh asked whether the hiccups in Regenerate, Catch up and the scheduled podcasts were being addressed. Every failure had a cause and a merged fix; two live runs proved them.

## What was found

- The 10-27 Catch up ([run](https://github.com/somesh-ks/knowledge-hub/actions/runs/40595695646)) lost its episode to a `rebase_conflict`: a Regenerate and the Catch up both appended to `state/costs-2026-10.json`. The cause and fix (`git/stateMerge.ts`, #391) are in [generation health](2026-10-27-generation-health.md). The podcast commit may touch only `Podcasts/`, the cost ledger and the timings file, and all three merge.
- The 10-27 and 10-28 Regenerates aired 4 of 8 stories, then none: the refill threw "5 Tech releases items; the limit is 1" after grounding dropped stories. #391's allowance trim covers it.
- The 10-25 weekly failed on a stale `config/queries.json` in the store (#303, [config store drift](2026-10-25-config-store-drift.md)); its rerun published 20 items.
- Health's "health.yml failed" count came from two manual runs on 10-22, before the workflow was scheduled. The Jobs rows ask GitHub for runs since a date, not a time, so a failure stays in the week for up to a day longer.
- `config.yml` failures were "Already a source" refusals, as designed.

## What was proved

On 10-29 a Regenerate of the 10-27 podcast and a Catch up, started 2 s apart, both published (13 stories, up from 3; $0.88 and $0.13). The Neon run log (`pipeline_runs`) got its first rows, with its tables created by the first write.

## Left open

- GitHub keeps one pending run per concurrency group: a Regenerate pressed while a daily is held (up to 135 min) is dropped if another request follows it. Not seen yet.
- `podcast.yml` reaches its first stage 9 s after the job starts (was 29 s with the ffmpeg step); the 5 s target in state.md is not met.
