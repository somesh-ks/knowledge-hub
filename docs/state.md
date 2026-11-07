# State

Updated 2026-11-06. Rewrite, never append.

## Working

- Engine live: [engine](specs/engine.md). A run that loses stories or races a push degrades, not fails, and records health (D204): [resilience](engineering/generation-resilience.md), [metrics](engineering/metrics.md).
- Reader: [library](specs/library.md), [settings](specs/settings.md), [health](specs/health.md), [look](specs/look-and-sound.md).
- Desktop layout: the column is centred in the pane, and a page with a contents list centres the column and the list together, the Library's width (D287).
- Player as one surface: transcript, chapters, a queue keeping played items (D277): [player](specs/player.md).
- Narration on Play, per story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199). Regenerate and Catch up queue with Cancel; ended runs stay for the day (D204, D231).
- Saved copies, offline, downloads, PWA: [navigation and offline](specs/navigation-and-offline.md).
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews a PR once when it is ready, by tier (D192, D292).
- Styles (D306, D310, D314, D315, D319): Halloween and Expressive, a Hue slider, live covers. closed when: Somesh OKs the stills ([ghost states](https://claude.ai/artifact/MVNhZmVMk4kYNu2tJbHRPp), [disabled](https://claude.ai/artifact/Kc7RaKbskg5UeGULwwKtU8)) and a style change on his phone recolours every page with no flash and survives a restart, and a press on the Library view toggle and a toast action beats hover.

- Avatar, Settings (D335, D344), Mood (D327), taps (D353): merged. closed when: his phone's shows come home.

## Tests

Unit (CI): 367 files, 5,572 tests, 2 min. Site e2e: 449, 14 min. Player: 80, 7 min.

## Not working or unverified

- D318 edge cache. closed when: a week of his loads is mostly HIT or STALE.
- Guardrails (D360): #673 awaits his merge, `secrets:push`. closed when: Health's Budgets are fresh.
- Rewrite (D376), Stories (D377). closed when: his next rewrite fetches in 1 min, plays at 0:00; 20 stories at 5 min air 20 in 5.5 min.
- Listen now streams (D366): parts as the script is written, for Catch up and Regenerate. closed when: Somesh's first live Catch up plays on his phone without a pause.
- Blob on Pro trial to 11-13 (D251, D256). Plan call 11-08: keep Pro. closed when: chosen.
- Deploy batching (D375): 5 merges, 3 hours or `[deploy]`. closed when: a merge day builds at most 8 times; `[deploy]` ships in minutes.
- Bottom bar ripple (D286, D347) and tab state. closed when: on his Android Chrome Settings pages rise, tabs slide at 250 ms, and the latest podcast keeps its tab lit.
- Run state in Postgres (D381): switch off, untried on Neon (runbook 14, 14.1). closed when: a daily run with it on leaves rows equal to `state/`.
- Config snapshot (D300 step 1): `snapshot.yml` writes `config_snapshots` each Sunday; untried on Neon. closed when: it has run once and `config restore --file` on a copy rebuilds the rows.
- Edge purge waits from the run's last save (#590, D318); the 11-03 daily waited 27 s. closed when: a Catch up's `content` log says `waiting N s` under 30 and its Library entry opens on the new page
- Queue (D346, D357), dock swipes (D359). The red strip's fix (#659) assumes Chrome's 8 px slop. closed when: on his Android a swipe shows a red strip, the player's swipes are silent, and the bar's pull fades to its target, line at bottom, no ring after a tap.
- Player ⋮ menu and Saved (D309, #580): checked in Chromium only. closed when: held press, the speed screen and Settings > Saved work on his Android Chrome.
- Voice list (D276): closed when: a voice is heard from its list on his iPhone.
- Copy says podcast, not briefing; code names keep `briefing` (D211). closed when: the next daily says "podcast".
- More menu (D214); Catch up album, Share circle, cards (D219); long press, haptics (D264, D273); push ping (D284). closed when: signed off.
- Two Catch ups in 24 h, made or under way (D213). closed when: a third is refused; a regenerate or delete uses none.
- Three regenerations per podcast, counted in its own file (D212). closed when: the page shows "2 of 3 regenerations left".
- Short podcasts (D204, D216 to D225). 11-05: dailies 1.04 and 1.02, metrics 7 of 10 runs at 1.02. closed when: two dailies in a row air within 10% of length, and `singularity metrics` shows ten runs at `length_share` 0.9+, `failure_rate` 0.1 or less.
- Every Claude step starts at Haiku medium, then Haiku high, then Sonnet medium (D308, D333, D334). 11-03 daily: share 1.04, 11 cents. closed when: two scheduled runs drop no more voice or grounding (`lost_reasons`) than the last Sonnet-only runs, and a podcast script holds `length_share` 0.9+ (else tell the owner).
- Ingest in shadow (D233, D251). 11-05: held 50% (Exa blogs miss), read 93%, not met. closed when: for 7 days the store holds 90% of each daily's stories and reads 90% of pages tried (`ingest --coverage`, in the health log).
- One Speechify count in Blob, a weekly Exa stop (D339). closed when: health shows the shared count after a narration and 450 Exa requests in a week warn.
- Trusted publishers (D234) and community lift (D240), shipped off. closed when: both on and a daily airs a lab story and a community-voted one, no source over 30%.
- Run names (D217), Neon run log (D221). closed when: a scheduled daily is named `daily <date>`, is off the queue, and has its row.
- `podcast.yml` no longer installs ffmpeg; its first stage starts 9 s in (29 s before). closed when: 9 s is accepted.
- Regenerate (D207, D323, D337, D340): a 10-minute one airs within 10%; the comment is required; Length and Categories show as words reach for them; full sheet (#589). closed when: signed off on his phone.
- Catch up script at medium effort (D324). closed when: two Catch ups air within 10% of length, faster; else high again.
- Podcast queue (D231, D242, #704): fakes only. closed when: a Catch up is cancelled, a failed run's Details read, and on his Android a head drag leaves the page still, the shimmer never restarts and a played-out run's ring completes.
- Owner's eye: bar centring (over 1px), centred column and label gap (D229), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off.
- Live content (plan 20): an open page elsewhere does not refresh in 60 s; `smokeLive.mjs --apply` never ran on production. closed when: checked.
- Reload mid-write (D259). closed when: a phone flip, then reload, holds.
- Offline (D299, D330, D331): fakes only. closed when: in airplane mode on his phone Saved and Settings open, a change syncs once online, nothing reloads.
- Settings paint the stored copy at once (D205); another device's edit waits for a reload toast. closed when: the owner signs off on a phone.
- Sources design (D124): production asks Jev for a source's format only after `secrets:push`; no run used a mix or cap. closed when: a production format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl and Gemini transcripts answered live; no full run used either. closed when: a digest has a YouTube finalist with `extract_method` captions or transcription.
- D145, D202 ([hardening](engineering/hardening.md)): health runs daily and `health-warnings` opened on 10-26; only the phone is unseen. closed when: a phone app loads a deploy itself.
- Downloads (D127, D281) on a phone: Blob CORS. closed when: Play works in airplane mode.
- Library list month label (D288) sticks and follows the app bar on a real phone. closed when: the owner scrolls the list on his phone and sees no gap or jump under the bar.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) has not run. closed when: an iPhone passes it.
- Time zone (D100, D239) only faked; `sinceLabel`, `pendingAudio` and `podcast/select` still use Stockholm's today. closed when: a run across the 10-25 clock change publishes on the right day.
- Config saves go through the config store (D149, D296); `config.yml` has nothing left to commit. Never seen live: `topic.scope`, rename or move, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics, episode delete or regenerate. closed when: each shows in the store row and on a second device.
- Admin Stage times (D260): `singularity-admin` needs `DATABASE_URL` and postgres. closed when: runs show.
- Owner config out of git (D296, merged). The 11-02 dry run's gate log said `config store:` and it published. closed when: the Vercel build log says `store on; from the store:`, audio publishing keeps the owner's voice, and the cron answers 200.
- Config store (D149, D296): Vercel has `SINGULARITY_CONFIG_STORE` and `DATABASE_URL` (checked 11-01); the Actions variable is unreadable, so `health` faults `config_store_split` when the site and runs disagree. closed when: a phone's edit shows on a laptop and health passes the config-store line.
- Live `GITHUB_SINGULARITY_TOKEN` write access untested. closed when: Generate dispatches.
- 45 older items are parked in history (`#parked`; [2026-10-31 trim](history/2026-10-31-state-trim.md)). closed when: each closes.

## Known risks

- Storage measured 2026-11-01: the Blob store is 133 MB (about 5.6 MB a day since it was created 10-06, so Hobby's 1 GB at about 5 months) and Neon is 11 MB (`ingest_items` 1.5 MB, 2,946 rows). The "near 10 GB" Vercel figure is neither. closed when: the Usage tab names it and the sizes are read again at the plan call (11-06 to 11-08).
- `main` has no ruleset: `.github/rulesets/main.json` was never imported (runbook, branch protection). closed when: the rulesets API lists it.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, within the caps.
- Budget counters can read below real spend: workflow and site count apart against one Speechify allowance.
- A Catch up that fails after its episode is committed (the audio job, or a late Cancel) frees its slot in the two-a-day cap (D213); the 12-a-day policy still bounds it.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces it (D79, D91).

## Next

1. Free the lane in the hold ([D209](decisions/engine.md)): step 1 is built (#399); steps 2, 4 and 5 are not. Step 3, the batch, shipped as D294. A batch left open is listed in `.cache/run/open-batches.json` and settled by run.yml's "Settle batches" step (`batch-settle`); unproven live. closed when: a scheduled run's write stage logs "Writer first pass by batch" with `back` above 0, and a run that gave up on a batch logs "Settled a batch the run had left open".
2. Owner: regenerate the 3-story 10-27 briefing? Revoke the Vercel token; delete empty store `store_JmrDq8MB5Kwn3ejW`; open calls: [PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
3. Firecrawl: owner prunes from the yield report. The free change check (D342) skips unchanged listings. closed when: a run skips one, then scrapes a changed one.
4. Lighthouse CSS defer parked: inlined critical CSS paints a cold phone in 1.0 s, not 3.2 s, but the CSP blocks it.
5. `topic` to `category` end to end (plan 14): an inventory, dual-name readers, a store-synced migration, the rename, then the old names go; only with no other PR open ([start](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
6. Controls (D237): Icon button, FAB, Chip, Link next. closed when: `NOT_YET_COMPONENTS` is empty. Icon size scale (D266).
7. First turn: `first_turn_chars` is recorded in `podcast-timings.json`; split it only if two runs show it long.
8. Parked by the owner on 1 Nov ([D302](decisions/engine.md)), no code: pipeline plan Steps 3 to 7 (this list named 3, 5, 6, 7: versions table, regenerate from a stage, git as export, feedback classifier) and the Firecrawl monitor pilot. The owner restarts or drops them.
