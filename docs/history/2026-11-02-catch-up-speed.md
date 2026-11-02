# 2026-11-02: the edge purge counts from the last save

Somesh found a 5-minute Catch up slow. Timing of run 41484563424 (before the content store took over from `content sync`): the podcast job 63 s (script 31 s), the audio job 85 s (checkout and install 9 s, ffmpeg 17 s, narration 28 s, then 24 s before GitHub marked the job done), then `content.yml` about 100 s.

## What changed

- #573 already removed the `content sync` step. Each job now saves its own files, so the episode is in the store when the podcast job ends.
- What was left in `content.yml` was a fixed `sleep 55` before the edge purge (D318), counted from the start of that job. By then the teardown, the queue and the install had used about 45 s of the 55. The wait now counts from the last `Save content` step of the triggering run, read from the run's jobs, so the purge comes 55 s after the write and not 55 s after the job started. With no save to find it counts from the end of the run; a hand run waits all of it. The wait itself (30 s manifest window plus the longest render) is unchanged, and `functionLimits.test.ts` still pins it.
- Expected saving: about 45 s of the roughly 4 minutes.

## Left out on purpose

- Narrating inside the podcast job. `audio.yml` has its own concurrency group because narration reads and writes the Speechify counter (`state/usage.json`, in git); two narrations at once lose an update. It also keeps the model keys and the database URL out of the narrating job (SEC-03).
- A purge in parallel with narration. The briefing pages show whether audio is ready, so a write by the audio job needs its own purge.
- Starting ffmpeg during the script step. The audio job is another runner; only a cached binary or a step that overlaps the 17 s with the install (6 s) would help, and neither is worth its risk yet.
