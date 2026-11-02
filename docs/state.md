# State

Updated 2026-11-02. Rewrite, never append.

## Working

- Engine live end to end: [engine](specs/engine.md). A run that loses stories or races a push degrades, not fails, and records health (D204): [resilience](engineering/generation-resilience.md), [metrics](engineering/metrics.md).
- Reader: [library](specs/library.md), [settings](specs/settings.md), [health](specs/health.md), [look](specs/look-and-sound.md).
- Desktop layout: the column is centred in the pane, and a page with a contents list centres the column and the list together, the Library's width (D287).
- Player as one surface: transcript, chapters, a queue that keeps played items (D277): [player](specs/player.md).
- Narration on Play, per story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199). Regenerate and Catch up queue with Cancel; ended runs stay for the day (D204, D231).
- Saved copies, offline, downloads, PWA: [navigation and offline](specs/navigation-and-offline.md).
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews a PR once when it is ready, by tier (D192, D292).
- Styles (D306, D310, D314, D315, D319): Halloween and Expressive, a Hue slider, live-vector covers (`cover.css`), and neutrals from a recipe per style (`styleRecipe.ts`). closed when: Somesh OKs the stills ([ghost states](https://claude.ai/artifact/MVNhZmVMk4kYNu2tJbHRPp)), a style change on his phone recolours every page, cover and header light with no flash and survives a restart, and a press on the Library view toggle and a toast action is deeper than the hover. Disabled controls stay still ([stills](https://claude.ai/artifact/Kc7RaKbskg5UeGULwwKtU8)).

## Tests

Unit (CI): 352 files, 5,449 tests, about 2 min. Site e2e: 448, 10 min. Player: 80, 7 min.

## Not working or unverified

- D318 edge cache. closed when: a week of his loads is mostly HIT or STALE.
- Blob on Pro trial since 10-30, ending 11-13 (D251, D256). Plan call 11-06 to 11-08 (Pro, or Hobby: 1.1K of 2,000 advanced Blob ops a month on 11-01), from the Usage tab. closed when: the plan is chosen.
- Bottom bar ripple (D286) and tab state. closed when: on his iPhone a tap shows the wave and one pill, and the latest podcast from the Library keeps it lit.
- Config snapshot (D300 step 1): `snapshot.yml` writes the config store to the `config_snapshots` table each Sunday and `config restore --latest` reads it back; untried against real Neon. closed when: the workflow has run once, the row exists, and `config restore --file` on a copy rebuilds the rows.
- Content out of git (D300 step 2b, #573): jobs `content pull --track` first and `content push` after the commit; `Digests/` and `Podcasts/` left `main`. closed when: the next scheduled daily's log shows `Load content` and `Save content` and its digest is on the site.
- Edge purge waits from the run's last save (#590, D318). closed when: a Catch up's `content` log says `waiting N s` with N under 30 and its Library entry opens on the new page
- Queue and bar (D277, D343, #615): a third-item tap keeps the bar up. closed when: on his Android Chrome the two-bar handle reorders, a swipe either way removes a row, and a swipe on the bar switches the podcast.
- Player ⋮ menu and Saved (D309, #580): checked in Chromium only. closed when: held press, the speed screen and Settings > Saved work on his Android Chrome.
- Voice list (D276): closed when: a voice is heard from its list on his iPhone.
- Copy says podcast, not briefing; code names keep `briefing` (D211). closed when: the next daily says "podcast".
- More menu (D214); Catch up album, Share circle, cards (D219); long press, haptics (D264, D273); push ping (D284). closed when: signed off.
- Two Catch ups in 24 hours, made or under way (D213). closed when: a third is refused; a regenerate or delete uses none.
- Three regenerations per podcast, counted in its own file (D212). closed when: the page shows "2 of 3 regenerations left".
- The 10-31 scheduled daily published nothing (a moved window, Tech over its allowance, stories lost in writing, a trimmed refill). Fixed: the window starts at its own last window; Tech may pass its allowance only to reach the floor (D297); the refill writes nothing the allowance will trim. closed when: the next two scheduled dailies publish.
- Short podcasts (D204, D216 to D225). closed when: two dailies in a row air within 10% of length, and `singularity metrics` shows ten runs at `length_share` 0.9+, `failure_rate` 0.1 or less.
- Haiku writes the first pass, Sonnet repairs (D308; `eval/writerModels.ts`, run 41348226002, 9 stories, one judge). The router is static (D209 chains), so no model is picked from feedback yet. closed when: two scheduled runs in a row show no more voice or grounding drops (`lost_reasons`) than the last Sonnet-only runs, and the writer's cost in the ledger is under a quarter of the Sonnet-only writer's.
- Ingest in shadow (D233, D251). closed when: for 7 days the store holds 90% of each daily's stories and reads 90% of pages tried (`ingest --coverage`).
- Trusted publishers (D234) and community lift (D240), shipped off. closed when: both on and a daily airs a lab story and a community-voted one, no source over 30%.
- Run names (D217), Neon run log (D221). closed when: a scheduled daily is named `daily <date>`, is off the queue, and has its row.
- `podcast.yml` no longer installs ffmpeg; its first stage starts 9 s in (29 s before). closed when: 9 s is accepted.
- Regenerate lengths (D207, D323): a 10-minute Regenerate airs within 10%. Its full sheet and smooth exit (D323) are with the design-system PR. closed when: signed off on his phone.
- Catch up script at medium effort (D324). closed when: two Catch ups air within 10% of length, faster; else high again.
- Podcast queue (D231, D242): fakes only. closed when: a Catch up is cancelled and a failed run's Details read.
- Owner's eye: bar centring (over 1px), centred column and label gap (D229), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off.
- Live content (plan 20): an open page elsewhere does not refresh in 60 s; `smokeLive.mjs --apply` never ran on production. closed when: checked.
- Reload mid-write (D259). closed when: a phone flip, then reload, holds.
- Offline settings outbox (D299): fakes only. closed when: on a phone in airplane mode a setting is changed, the app is closed, and it reaches the site once back online.
- Settings paint the stored copy at once (D205); another device's edit waits for a reload toast. closed when: the owner signs off on a phone.
- Sources design (D124): production asks Jev for a source's format only after `secrets:push`; no run used a mix or cap. closed when: a production format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl and Gemini transcripts answered live; no full run used either. closed when: a digest has a YouTube finalist with `extract_method` captions or transcription.
- D145, D202 ([hardening](engineering/hardening.md)): health runs daily and `health-warnings` opened on 10-26; only the phone is unseen. closed when: a phone app loads a deploy itself.
- Downloads (D127, D281) on a phone: Blob CORS. closed when: Play works in airplane mode.
- Library list month label (D288) sticks and follows the app bar on a real phone. closed when: the owner scrolls the list on his phone and sees no gap or jump under the bar.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) has not run. closed when: an iPhone passes it.
- Time zone (D100, D239) only faked; `sinceLabel`, `pendingAudio` and `podcast/select` still use Stockholm's today. closed when: a run across the 10-25 clock change publishes on the right day.
- Config saves go through the config store (D149, D296); `config.yml` has nothing left to commit. Never seen live: `topic.scope`, rename or move, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics, episode delete or regenerate. closed when: each shows in the store row and on a second device.
- Admin env (D257): the reader needs `ADMIN_SESSION_SECRET`. closed when: `/api/health` answers 401 signed out.
- Owner config out of git (D296, merged). The 11-02 dry run's gate log said `config store:` and it published. closed when: the Vercel build log says `store on; from the store:`, audio publishing keeps the owner's voice, and the cron answers 200.
- Config store (D149, D296): Vercel has `SINGULARITY_CONFIG_STORE` and `DATABASE_URL` (checked 11-01); the Actions variable is unreadable, so `health` faults `config_store_split` when the site and runs disagree. closed when: a phone's edit shows on a laptop and health passes the config-store line.
- Production's `GITHUB_SINGULARITY_TOKEN` is unchecked since 10-14 (`doctor --online` tests it and its expiry, not write access). closed when: `doctor --online` accepts it.
- 45 older items are parked in history (`#parked`; [2026-10-31 trim](history/2026-10-31-state-trim.md)). closed when: each closes.

## Known risks

- Storage measured 2026-11-01: the Blob store is 133 MB (about 5.6 MB a day since it was created 10-06, so Hobby's 1 GB at about 5 months) and Neon is 11 MB (`ingest_items` 1.5 MB, 2,946 rows). The "near 10 GB" Vercel figure is neither. closed when: the Usage tab names it and the sizes are read again at the plan call (11-06 to 11-08).
- `main` has no ruleset: `.github/rulesets/main.json` was never imported (runbook, branch protection). closed when: the rulesets API lists it.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, within the caps.
- Budget counters can read below real spend: workflow and site count apart against one Speechify allowance.
- A Catch up that fails after its episode is committed (the audio job, or a late Cancel) frees its slot in the two-a-day cap (D213); the 12-a-day policy still bounds it.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces it; closing the tab within 10 s loses it (D79, D91).

## Next

1. Free the lane in the hold ([D209](decisions/engine.md)): step 1 is built (#399); steps 2, 4 and 5 are not. Step 3, the batch, shipped as D294. A batch the wait gives up on, or a cancel leaves running, is listed in `.cache/run/open-batches.json` and settled by run.yml's "Settle batches" step (`batch-settle`) before Commit; the step needs a manual merge and is unproven live. closed when: a scheduled run's write stage logs "Writer first pass by batch" with `back` above 0, and a run that gave up on a batch logs "Settled a batch the run had left open".
2. Owner: regenerate the 3-story 10-27 briefing? Revoke the Vercel token; delete empty store `store_JmrDq8MB5Kwn3ejW`; open calls: [PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
3. Firecrawl: a per-source yield table for the owner to prune (21 sources gave 1 story per 4,460 credits a month); changelog providers once the pilot holds.
4. Lighthouse: defer BaseLayout's 34 KiB CSS without breaking the bar; the 1.4 s chain.
5. `topic` to `category` end to end (plan 14): an inventory, dual-name readers, a store-synced migration, the rename, then the old names go; only with no other PR open ([start](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
6. Controls (D237): Icon button, FAB, Chip, Link next. closed when: `NOT_YET_COMPONENTS` is empty. Icon size scale (D266).
7. Performance: split a long first turn at its first sentence ([note](history/2026-10-12-polish-and-performance-pass.md)); each source is read once per run.
8. Parked by the owner on 1 Nov ([D302](decisions/engine.md)), no code: pipeline plan Steps 3 to 7 (this list named 3, 5, 6, 7: versions table, regenerate from a stage, git as export, feedback classifier) and the Firecrawl monitor pilot. The owner restarts or drops them.
