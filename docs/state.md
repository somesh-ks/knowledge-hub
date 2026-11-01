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
- Halloween style (D306): tokens, Pirata One page title, six scenes and a cobweb, in two pull requests (tokens, then scenes). closed when: Somesh OKs the stills (390 and 1280, light and dark) and a phone keeps it across a reload. Covers follow as inline SVG with variables in their own PR.

## Tests

Unit (CI): 326 files, 5,171 tests, 86s. Site e2e: 411, 10 min. Player: 77, 6 min.

## Not working or unverified

- Skew protection off (D316): prod had no modulepreload links, two player.css links. closed when: the live home page has preload links, one player.css, no `?dpl=`.
- Blob on Pro trial since 10-30, ending 11-13 (D251, D256). Plan call (Pro, or Hobby with Blob under about 1,000 ops a month and under 70 deploys a day) at 11-06 to 11-08, read from the Vercel Usage tab, which is the only Blob op count (none in code). closed when: the plan is chosen and ops stay under 1,000 a month.
- Bottom bar press ripple (D286). closed when: a tap on the bar on his iPhone shows the wave from the thumb, the pill eases in, and the move carries the wave.
- Config snapshot (D300 step 1): `snapshot.yml` writes the config store to a private Blob store each Sunday and `config restore` reads it back; untried against a real store, which needs the second Blob store and `BLOB_PRIVATE_READ_WRITE_TOKEN` (runbook 1.5a). closed when: the workflow has run once, the snapshot is in the store, and `config restore --file` on a copy of it rebuilds the rows.
- Content store delta writes (D300 step 2a): `content put|remove|pull` change single files with an ETag-guarded manifest; one writer per path is assumed. No workflow uses them yet. closed when: 2b has run a daily end to end through them and the store matches the digests the run wrote.
- Queue plays in place (D277). closed when: a third-item tap keeps the bar up.
- Expressive style (#506; D268, D274, D275, D278) with a Style select in Appearance. closed when: a style chosen on a real phone survives a reload and an app restart.
- Voice list (D276): closed when: a voice is heard from its list on his iPhone.
- Copy says podcast, not briefing; code names keep `briefing` (D211). closed when: the next daily says "podcast".
- More menu (D214); Catch up album, Share circle, cards (D219); long press, haptics (D264, D273); push ping (D284). closed when: signed off.
- Two Catch ups in 24 hours, made or under way (D213). closed when: a third is refused; a regenerate or delete uses none.
- Three regenerations per podcast, counted in its own file (D212). closed when: the page shows "2 of 3 regenerations left".
- The 10-31 scheduled daily published nothing: a 6-hour window (an on-demand briefing had moved the shared start), 11 Tech stories over the Tech allowance, 2 of 4 stories lost in writing, and a refill whose 3 Tech picks the allowance trimmed again. Fixed: the regular window starts at its own last window; a Tech-heavy day may air Tech past its allowance only to reach the floor (D297); the refill writes nothing the allowance will trim. closed when: the next two scheduled dailies publish.
- Short podcasts (D204, D216 to D225). closed when: two dailies in a row air within 10% of length, and `singularity metrics` shows ten runs at `length_share` 0.9+, `failure_rate` 0.1 or less.
- Haiku writes the first pass, Sonnet repairs (D308; `eval/writerModels.ts`, run 41348226002, 9 stories, one judge). The router is static (D209 chains), so no model is picked from feedback yet. closed when: two scheduled runs in a row show no more voice or grounding drops (`lost_reasons`) than the last Sonnet-only runs, and the writer's cost in the ledger is under a quarter of the Sonnet-only writer's.
- Ingest in shadow (D233, D251). closed when: for 7 days the store holds 90% of each daily's stories and reads 90% of pages tried (`ingest --coverage`).
- Trusted publishers (D234) and community lift (D240), shipped off. closed when: both on and a daily airs a lab story and a community-voted one, no source over 30%.
- Run names (D217), Neon run log (D221). closed when: a scheduled daily is named `daily <date>`, is off the queue, and has its row.
- `podcast.yml` no longer installs ffmpeg; its first stage starts 9 s into the job (29 s before). closed when: 9 s is accepted or a target set.
- A Regenerate can ask for 3, 5, 10 or 15 minutes (D207): The input is on `main`. closed when: a 10-minute Regenerate airs within 10% of 10.
- Podcast queue (D231, D242): fakes only. closed when: a Catch up is cancelled and a failed run's Details read.
- Owner's eye: bar centring (over 1px), centred column and label gap (D229), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off.
- Live content (plan 20): an open page elsewhere does not refresh in 60 s; `smokeLive.mjs --apply` never ran on production. closed when: checked.
- Reload mid-write (D259). closed when: a phone flip, then reload, holds.
- Offline settings outbox (D299): fakes only. closed when: on a phone in airplane mode a setting is changed, the app is closed, and it reaches the site once back online.
- Settings paint the stored copy at once, the theme before first paint (D205); another device's edit waits for a reload toast; a first visit after a config change waits up to 2.5 s. closed when: the owner signs off on a phone.
- Sources design (D124): production asks Jev for a source's format only after `secrets:push`; no run used a mix or cap. closed when: a production format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl and Gemini transcripts answered live; no full run used either. closed when: a digest has a YouTube finalist with `extract_method` captions or transcription.
- D145, D202 ([hardening](engineering/hardening.md)): health runs daily and `health-warnings` opened on 10-26; only the phone is unseen. closed when: a phone app loads a deploy itself.
- Downloads (D127, D281) on a phone: Blob CORS. closed when: Play works in airplane mode.
- Library list month label (D288) sticks and follows the app bar on a real phone. closed when: the owner scrolls the list on his phone and sees no gap or jump under the bar.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) has not run. closed when: an iPhone passes it.
- Time zone (D100, D239) only faked; `sinceLabel`, `pendingAudio` and `podcast/select` still use Stockholm's today. closed when: a run across the 10-25 clock change publishes on the right day.
- Config saves go through the config store (D149, D296); `config.yml` has nothing left to commit. Never seen live: `topic.scope`, rename or move, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics, episode delete and regenerate. closed when: each shows in the store row and on a second device.
- Admin env (D257): the reader needs `ADMIN_SESSION_SECRET`. closed when: `/api/health` answers 401 signed out.
- Owner config out of git (D296, built, unmerged until the owner's review). closed when: after the merge the next scheduled daily's gate log says `config store:` and it publishes, the Vercel build log says `store on; from the store:`, audio publishing keeps the owner's voice, and the cron answers 200.
- Config store (D149, D296): Vercel has `SINGULARITY_CONFIG_STORE` and `DATABASE_URL` (checked 11-01); the Actions variable could not be read, so `health` faults `config_store_split` when the site and runs disagree. closed when: a phone's edit shows on a laptop and health passes the config-store line.
- Production's `GITHUB_SINGULARITY_TOKEN` is unchecked since 10-14 (`doctor --online` tests it and its expiry; write access it cannot test). closed when: `doctor --online` accepts it.
- 35 older items parked in history (`#parked`, 10-21 to 10-28) and 10 more ([2026-10-31 trim](history/2026-10-31-state-trim.md)). closed when: each closes.

## Known risks

- Storage measured 2026-11-01: the Blob store is 133 MB (about 5.6 MB a day since it was created 10-06, so Hobby's 1 GB at about 5 months) and Neon is 11 MB (`ingest_items` 1.5 MB, 2,946 rows). The "near 10 GB" Vercel figure is neither, source unknown. closed when: the 10 GB is named in the Usage tab, and the sizes are read again at the plan call (11-06 to 11-08).
- `main` has no ruleset: `.github/rulesets/main.json` was never imported (runbook, branch protection). closed when: the rulesets API lists it.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, within the caps.
- Budget counters can read below real spend: workflow and site count apart against one Speechify allowance.
- A Catch up that fails after its episode is committed (the audio job, or a late Cancel) frees its slot in the two-a-day cap (D213); the 12-a-day policy still bounds it.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces it; closing the tab within 10 s loses it (D79, D91).

## Next

1. Free the lane in the hold ([D209](decisions/engine.md)): step 1 is built (#399); steps 2, 4 and 5 are not. Step 3, the batch, shipped as D294 inside the existing job, so it did not need step 2's split. Check the first scheduled run's ledger for `batch_*` units. A batch the wait gives up on, or that a cancel leaves running, is listed in `.cache/run/open-batches.json` and settled by run.yml's "Settle batches" step (`batch-settle`) before Commit; the step needs a manual merge and is unproven live. closed when: a scheduled run's write stage logs "Writer first pass by batch" with `back` above 0, and a run that gave up on a batch logs "Settled a batch the run had left open".
2. Owner: regenerate the 3-story 10-27 briefing? Revoke the Vercel token; delete empty store `store_JmrDq8MB5Kwn3ejW`; open calls: [PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
3. Firecrawl: a per-source yield table for the owner to prune (21 sources gave 1 story per 4,460 credits a month); changelog providers once the pilot holds.
4. Lighthouse: defer BaseLayout's 34 KiB CSS without breaking the bar; the 1.4 s chain.
5. `topic` to `category` end to end (plan 14): an inventory, dual-name readers, a store-synced migration, the rename, then the old names go; only with no other PR open ([start](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
6. Controls (D237): Icon button, FAB, Chip, Link next. closed when: `NOT_YET_COMPONENTS` is empty. Icon size scale (D266).
7. Performance: one fetch for both briefing passes, rewrite only a thin story, split a long first turn (D141, D178).
8. Parked by the owner on 1 Nov ([D302](decisions/engine.md)), no code: pipeline plan Steps 3 to 7 (this list named 3, 5, 6, 7: versions table, regenerate from a stage, git as export, feedback classifier) and the Firecrawl monitor pilot. The owner restarts or drops them.
