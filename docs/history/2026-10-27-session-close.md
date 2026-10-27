# 2026-10-26 to 27: about 50 PRs, then the close

Two days, #315 to #382. The first day merged about 50 PRs: live content and deletes (D199), the strict publish time (D197), Opus narration (D198), player autoplay and per-episode speed (D193), settings breadcrumbs (D195), topic weight removed (D194), the save refresh (D196), the Alexandria pilot and `fetch_via` (D200), and browser CI on every push to main. The owner closed the write-route auth PR (D201).

## The close (2026-10-27)

Worked from a hand-off brief, now deleted. What changed:

- **Review loops closed.** #371, #376, #377 and #379 had unanswered CodeRabbit threads. Each was fixed or declined in its thread, then merged. Two were real bugs: a store read that ended after a page swap released the next page's held regions (#377); and on #378, the profile confirm dialog sat outside the editor's root, so Podcast structure had no handlers. That one also explained #378's two red browser tests.
- **Preferences polish (#378).** All six owner items were checked against screenshots at 390 and 1280, light and dark. A removed section now leaves the kept Custom list too (red first).
- **Opus never ran on the runners (#381).** The 2026-10-27 digest had no `m4a_url`, and CI logged the real-ffmpeg test as skipped: the runner image has no libopus. Installing ffmpeg 6.1 locally turned that test red. ffprobe's duration counts MP3 padding (52 ms a turn), so an episode's turn offsets drifted. Turns are now measured by decoding, and the workflows install ffmpeg (8.0.1 on the runner).
- **Instant paint, half done (#382).** The Settings index lines are held for the store. Showing the device's copy at once broke the D172 journey: another device's edit waited for a reload toast. That is left for the owner to decide (state.md).
- **The 3-story briefing.** The 10-27 run log: write 8, `grounding_dropped` 5, `refill_written` 0. #373 and #375 had already landed; the next daily tells.

Left for later, with reasons: the topic-to-category rename and the design sweep (multi-PR, the rename needs the owner's review of an inventory first); the Firecrawl yield table and Lighthouse CSS (state.md, Next); smokeLive (the owner's command only).

## Parked

Moved from state.md to keep it within budget; each still holds until its condition is met.

- D125: pull to close, sticky tabs, keyboard fit. closed when: each works on phone.
- Live runs of the 2026-10-18 changes: release news last, the sized weekly. closed when: a daily files Launches last; a Sunday weekly airs within 10% of 15 minutes.
- PWA (D123) on a device: Android bars after a reinstall, splash to launch-screen hand-off. closed when: both match the theme after an Android reinstall.
- The first press on a cold audio device blocks about 200 ms (`new AudioContext()` in `packages/sound`). closed when: the owner decides on that package's first rule.
- The daily Type is saved but not applied (narration reads the digest in one voice). closed when: the owner decides on a podcast step in `audio.yml` or drops the field.
- With a mouse a story chip grows 11px from idle to played (it reserves "Play again"). closed when: the chip keeps one width in a browser assertion.
- On a 360x740 phone the sticky Generate bar covers More options on `/create` at rest. closed when: axe reports no obscured target there.
- An aggregator's or redirect's link to a blocked outlet is not caught. closed when: matching resolves the final URL, or the owner accepts it.
- Settings logic gaps (D102): a partial `skip_topics` without `general_scoped` un-skips general topics (the site never sends it); `topic.enabled` is never set false (dead branches). closed when: each is fixed or removed with a test.
- Link cards (D153 stage 0). closed when: a briefing link pasted in WhatsApp, iMessage and Slack shows its card.
- `serviceWorker.spec.ts:140` failed 1 of 373 local runs (an icon stylesheet preload as the page went offline), never in CI. closed when: a trace names the cause or 500 runs pass.
- `doctor --online` does not check `GITHUB_SINGULARITY_TOKEN`, and no end-to-end test applies a real op array through `config apply`. closed when: both exist.
