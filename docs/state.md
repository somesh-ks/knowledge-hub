# State

Updated 2026-11-01. Rewrite, never append.

## Working

- Engine live end to end: [engine](specs/engine.md). A run that loses stories or races a push degrades, not fails, and records health (D204): [resilience](engineering/generation-resilience.md), [metrics](engineering/metrics.md).
- Reader: [library](specs/library.md), [settings](specs/settings.md), [health](specs/health.md), [look](specs/look-and-sound.md).
- Desktop layout: the column is centred in the pane, and a page with a contents list centres the column and the list together, the Library's width (D287).
- Player as one surface: transcript, chapters, a queue that keeps played items (D277): [player](specs/player.md).
- Narration on Play, per story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199). Regenerate and Catch up queue with Cancel; ended runs stay for the day (D204, D231).
- Saved copies, offline, downloads, PWA: [navigation and offline](specs/navigation-and-offline.md).
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews PRs (D192).

## Tests

Unit (CI): 326 files, 5,171 tests, 86s. Site e2e: 411, 10 min. Player: 77, 6 min.

## Not working or unverified

- Blob on Pro trial since 10-30, ending 11-13 (D251, D256). Plan call (Pro, or Hobby with Blob under about 1,000 ops a month and under 70 deploys a day) at 11-06 to 11-08, read from the Vercel Usage tab, which is the only Blob op count (none in code). closed when: the plan is chosen and ops stay under 1,000 a month.
- Queue plays in place (D277). closed when: a third-item tap keeps the bar up.
- Expressive style (#506; D268, D274, D275, D278) with a Style select in Appearance. closed when: a style chosen on a real phone survives a reload and an app restart.
- Voice list (D276): closed when: a voice is heard from its list on his iPhone.
- Copy says podcast, not briefing; code names keep `briefing` (D211). closed when: the next daily says "podcast".
- More menu (D214); Catch up album, Share circle, cards (D219); long press, haptics (D264, D273); push ping (D284). closed when: signed off.
- Two Catch ups in 24 hours, made or under way (D213). closed when: a third is refused; a regenerate or delete uses none.
- Three regenerations per podcast, counted in its own file (D212). closed when: the page shows "2 of 3 regenerations left".
- The 10-31 scheduled daily published nothing (pool 94 against 492 to 647; the 10-30 on-demand briefing probably took the unseen items). closed when: two scheduled dailies in a row publish.
- Short podcasts (D204, D216 to D225). closed when: two dailies in a row air within 10% of length, and `singularity metrics` shows ten runs at `length_share` 0.9+, `failure_rate` 0.1 or less.
- Ingest in shadow (D233, D251). closed when: for 7 days the store holds 90% of each daily's stories and reads 90% of pages tried (`ingest --coverage`).
- Trusted publishers (D234) and community lift (D240), shipped off. closed when: both on and a daily airs a lab story and a community-voted one, no source over 30%.
- Run names (D217), Neon run log (D221). closed when: a scheduled daily is named `daily <date>`, is off the queue, and has its row.
- `podcast.yml` no longer installs ffmpeg; its first stage starts 9 s into the job (29 s before). closed when: 9 s is accepted or a target set.
- A Regenerate can ask for 3, 5, 10 or 15 minutes (D207): The input is on `main`. closed when: a 10-minute Regenerate airs within 10% of 10.
- Podcast queue (D231, D242): fakes only. closed when: a Catch up is cancelled and a failed run's Details read.
- Owner's eye: bar centring (over 1px), centred column and label gap (D229), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off.
- Live content (plan 20): an open page elsewhere does not refresh in 60 s; `smokeLive.mjs --apply` never ran on production. closed when: checked.
- Reload mid-write (D259). closed when: a phone flip, then reload, holds.
- Settings paint the stored copy at once, the theme before first paint (D205); another device's edit waits for a reload toast; a first visit after a config change waits up to 2.5 s. closed when: the owner signs off on a phone.
- Sources design (D124): production asks Jev for a source's format only after `secrets:push`; no run used a mix or cap. closed when: a production format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl and Gemini transcripts answered live; no full run used either. closed when: a digest has a YouTube finalist with `extract_method` captions or transcription.
- D145, D202 ([hardening](engineering/hardening.md)): health runs daily and `health-warnings` opened on 10-26; only the phone is unseen. closed when: a phone app loads a deploy itself.
- Downloads (D127, D281) on a phone: Blob CORS. closed when: Play works in airplane mode.
- Library list month label (D288) sticks and follows the app bar on a real phone. closed when: the owner scrolls the list on his phone and sees no gap or jump under the bar.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) has not run. closed when: an iPhone passes it.
- Time zone (D100, D239) only faked; `sinceLabel`, `pendingAudio` and `podcast/select` still use Stockholm's today. closed when: a run across the 10-25 clock change publishes on the right day.
- Config saves go through the config store (D149, D185); `config.yml` last ran 10-25. Never seen live: `topic.scope`, rename or move, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics, episode delete and regenerate. closed when: each lands as a `main` commit.
- Admin env (D257): the reader needs `ADMIN_SESSION_SECRET`. closed when: `/api/health` answers 401 signed out.
- Config store (D149, D185): Vercel has `SINGULARITY_CONFIG_STORE` and `DATABASE_URL` (checked 11-01); the Actions variable could not be read, so `health` faults `config_store_split` when the site and runs disagree. closed when: a phone's edit shows on a laptop and health passes the config-store line.
- A pending `config.yml` run can be cancelled by GitHub after a 202 (shared `singularity` group); production's `GITHUB_SINGULARITY_TOKEN` is unchecked since 10-14 (`doctor --online` now tests it and its expiry; write access it cannot test). closed when: a config save from the site produces a commit.
- 35 older items parked in history (`#parked`, 10-21 to 10-28) and 10 more ([2026-10-31 trim](history/2026-10-31-state-trim.md)). closed when: each closes.

## Known risks

- Vercel storage near 10 GB. closed when: explained.
- `main` has no ruleset: `.github/rulesets/main.json` was never imported (runbook, branch protection). closed when: the rulesets API lists it.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, within the caps.
- Budget counters can read below real spend: workflow and site count apart against one Speechify allowance.
- A Catch up that fails after its episode is committed (the audio job, or a late Cancel) frees its slot in the two-a-day cap (D213); the 12-a-day policy still bounds it.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces it; closing the tab within 10 s loses it (D79, D91).

## Next

1. Free the lane in the hold ([D209](decisions/engine.md)): step 1 is built (#399); steps 2, 4 and 5 are not. Step 3, the batch, shipped as D294 inside the existing job, so it did not need step 2's split. Check the first scheduled run's ledger for `batch_*` units. closed when: a scheduled run's write stage logs "Writer first pass by batch" with `back` above 0.
2. Owner: regenerate the 3-story 10-27 briefing? Revoke the Vercel token; delete empty store `store_JmrDq8MB5Kwn3ejW`; open calls: [PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
3. Firecrawl: a per-source yield table for the owner to prune (21 sources gave 1 story per 4,460 credits a month); changelog providers once the pilot holds.
4. Lighthouse: defer BaseLayout's 34 KiB CSS without breaking the bar; the 1.4 s chain.
5. `topic` to `category` end to end (plan 14): an inventory, dual-name readers, a store-synced migration, the rename, then the old names go; only with no other PR open ([start](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
6. Controls (D237): Icon button, FAB, Chip, Link next. closed when: `NOT_YET_COMPONENTS` is empty. Icon size scale (D266).
7. Performance: one fetch for both briefing passes, rewrite only a thin story, split a long first turn (D141, D178).
8. Parked, no code: pipeline plan Steps 3, 5, 6, 7 (versions table, regenerate from a stage, git as export, feedback classifier) and the D235 Firecrawl monitor pilot. The owner restarts or drops them.
