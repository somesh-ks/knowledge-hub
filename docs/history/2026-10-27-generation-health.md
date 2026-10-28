# 2026-10-27: generation health

One `/goal` after a Regenerate that aired 2 of 5 minutes and a Catch up that lost its written episode (D202). Eight phone screenshots, a Regenerate sheet with its own stepper, a failed bar that laid out badly, and unselected chips that could not be seen.

## What was found

- The Catch up (run 40595695646) failed at the push: a digest run and an episode run each added records to `state/costs-2026-10.json` within a second, and the rebase kept neither. `git/stateMerge.ts` now merges the cost ledger, timings, usage counter and run metrics by key.
- The Regenerate (run 40595530256) wrote 8 stories, grounding dropped 4, the refill threw on a section over its allowance, and 4 aired. Grounding now cuts a sentence before it drops a story, a section over its allowance trims, and a writer batch is written again in halves.
- A discussion nugget was asked for more words than one turn holds while the prompt said "one turn"; `nuggetLine` tells it in as many turns as the words need. A Catch up now selects half again as many stories as it airs.
- Speed: voice rewrites ran one story at a time (now four), grounding at five (now eight), and `podcast.yml` spent 17 s installing ffmpeg it does not use. That edit is in a workflow file and needs a manual merge.

## What was built

- Metrics: `state/run-metrics.json`, `singularity metrics`, `health` warnings and [metrics](../engineering/metrics.md) with targets.
- The UI: a Regenerate is followed in the Catch up run card (strip above the bottom bar on a phone, side column card from 64rem); a failure line with its reason; the card reserves its room (`--run-room`) so the floating button rides above it; "Listen now" keeps a gutter; sheet chips sit a hover step above the sheet colour; a live episode's cover box takes the cover's colour from the stream document.
- Dedupe: a copy the discovery search found ranks below the outlet's own feed entry; sources of equal signal had fallen back to the order of their ids, which put `exa-discovery` first.
- Settings: the kept store copy and the theme paint without the 300 ms wait or the page script (D203), measured at 163 to 184 ms and about 70 ms. A briefing run that ends behind the open player is told in a toast again; the player suite's two stepper tests follow the run line.

## What was not done, and why

- pnpm: spiked, works locally, not adopted (D204).

- A Length control in the Regenerate sheet and a longer length option. The 15-minute option already fills the 19,000-character narration request; a longer one needs chunked narration first. The daily length is the owner's, in Preferences (the store owns it, D149, D185).
- A drawn cover for a live episode. It would take a serverless renderer; the colour is the cheap part.

## Parked

Moved from state.md to keep it within budget; each still holds until its condition is met.

- Episode pre-narration (D128): no live run; `podcast.yml` calls `audio.yml` (#183); `SPEECHIFY_VOICE_ID_B` on GitHub must match Vercel's. closed when: a new episode's commit is followed by an `audio.yml` run and its turns are in Blob.
- Taste check (D118): Jev 1.14 live, taste answers on real candidates, an open from a real phone. closed when: a run log shows `taste` answers and an open from a phone reaches the vote batch.
- Covers and header light (D110, D122): monthly covers on the deployed site; the light on a real GPU, Safari and Firefox; a theme switch past 400 ms. closed when: phone and desktop screenshots of production show each.
- Scoring sample (D70): most sources still New. closed when: two weeks on, under 10% of switched-on sources read New.
- Unverified (D106 to D109): the volume slider's linger and hold while dragged, the highlight's pause on a live briefing, a vote batch sent on unload, a briefing regenerated with a topic its run did not fetch, a custom topic's prefill in Regenerate. closed when: each is seen once on production.
- Live services never called from production: Anthropic, the Speechify voice list and samples, `/api/source-preview`, `/api/site-icon`. closed when: each answers once on production.
- Player tabs and queue (D126, D133): Stories with the live transcript, Up next as a tab, the handle drag, the chevron. closed when: each works on a phone and the queue starts the next item at an end.
