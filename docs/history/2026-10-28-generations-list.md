# 2026-10-28: a list of generations, with Cancel

The owner, after the generation-health work: "a simpler way to track the queue of generation on mobile and desktop", an icon for generations (not downloads) with a popover, an empty state that starts a Catch up, and rows like a download list: thumbnail, bar, time left, Cancel.

## What was built

- Server: `GET /api/generations` (queued and running runs of both workflows, at most 6, stage and estimates from `progressOf`) and `POST /api/cancel` (ours only, the burst cap, GitHub's 409 read as "finished"). `/api/status` reports a cancelled run as `outcome: "cancelled"`. A briefing's time left comes from the medians of the last ten runs' `stage_ms`.
- Page: `GenerationsMenu.astro` (the icon with a progress ring, a popover that is the More menu's surface, a row template), `scripts/generations.ts` (loaded on first use; polls every 4 s while open), `lib/generations.ts` (a row's title, meta, progress, tint). The strip gained Cancel and "All generations"; the run card ends as "Cancelled".
- Tests: unit for the routes, `describeGeneration` and `cancelRun`; `e2e/generations.spec.ts` for the empty state, a Cancel that works and one that fails, the strip's way in and a cancelled run's end.

## Decisions

[D208](../decisions/episodes.md). The feature rides on the PR of the generation-health branch (#391); its commits are separable if the owner wants it in its own PR.

## Not verified

See state.md: a real cancel, the token's Actions write, a live copy left "writing", a briefing's time left before three timed runs exist.

## Parked

Moved from state.md to keep it within budget; each still holds until its condition is met.

- Software Engineering (D155) live. closed when: a digest has its section.
- Timings (D80 to D82: press to episode about 2.2 min) are from the fixture build. closed when: one real episode is timed against the note.
- Thresholds untuned: Jev 0.4 and 0.5, Trending clustering, source scores (D55), the vote numbers, `auto_adjust` (D190). closed when: each is checked against the golden set or two weeks of real data.
- Model orchestrator (D136): never run live. closed when: a run log names the resolved models.
- [Analytics](../specs/analytics.md) (D154). closed when: a live page view, `share` and `listen_half` show up.
- No island at first load (D178). closed when: the owner's phone shows the bar promptly after a first Play.
- Player tabs and queue (D126, D133): Stories with the live transcript, Up next, the handle drag, the chevron. closed when: each works on a phone and the queue starts the next item at an end.
- Episode pre-narration (D128): no live run; `podcast.yml` calls `audio.yml` (#183); GitHub's `SPEECHIFY_VOICE_ID_B` must match Vercel's. closed when: a new episode's commit is followed by an `audio.yml` run and its turns are in Blob.
- Taste check (D118): Jev 1.14 live; taste on real candidates; an open from a phone. closed when: a run log shows `taste` answers and an open from a phone reaches the vote batch.
- Covers and header light (D110, D122): monthly covers deployed; the light on a real GPU, Safari, Firefox; a theme switch past 400 ms. closed when: phone and desktop screenshots of production show each.
- Unverified (D106 to D109): the volume slider's linger and drag hold, the highlight's pause on a live briefing, a vote batch sent on unload, a briefing regenerated with a topic its run did not fetch, a custom topic's prefill in Regenerate. closed when: each is seen once on production.
