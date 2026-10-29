# State

Updated 2026-10-29. Rewrite, never append. [Specs](specs/README.md), [decisions](decisions/README.md), [history](history/README.md).

## Working

- Engine live end to end (fetch, Jev judge, writer, validate, commit), sized by the owner's length with spares: [engine](specs/engine.md). A run that loses stories or races a push degrades, not fails, and records its health (D204): [resilience](engineering/generation-resilience.md), [metrics](engineering/metrics.md).
- Reader (Latest, Library, Catch up, Settings): [library](specs/library.md), [create](specs/create.md), [settings](specs/settings.md), [health](specs/health.md), [look and sound](specs/look-and-sound.md).
- Player as one surface: transcript with word light, chapters in the bar, a queue with Up next (D126): [player](specs/player.md).
- Narration on Play, story by story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes; Opus, MP3 fallback (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199). A Regenerate and a Catch up are followed in the podcast queue, each with Cancel; ended runs stay for the day (D204, D231).
- Saved copies, offline shell, downloads, the PWA: [navigation and offline](specs/navigation-and-offline.md).
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews PRs (D192); merge by hand (D143).
- Tooling: subagents, `/close-session` ([roster](history/2026-10-08-subagent-roster.md)). Design lookup: `npm run ds` (D236).

## Tests

Unit (CI): 325 files, 5,148 tests, 86 s. Site e2e: 411, 10 min. Player e2e: 77, 6 min.

## Not working or unverified

- Copy says podcast, not briefing; code names keep `briefing` (D211). closed when: the next daily ends "the podcast".
- More menu (D214); Catch up album, Share circle, cards (D219). closed when: signed off.
- Two Catch ups in 24 hours, made or under way (D213). closed when: a third is refused; a regenerate or delete uses none.
- Three regenerations per podcast, counted in its own file (D212). closed when: one regenerated live shows "2 of 3 regenerations left" and its file has `regenerations: 1`.
- Short podcasts (D204, D216 to D225). closed when: two dailies in a row air within 10% of their length, `singularity metrics` shows ten runs at `length_share` 0.9 or more, `failure_rate` 0.1 or less, and a Regenerate pressed during a Catch up publishes both.
- Ingest in shadow (D233). closed when: for 7 days the store holds 90% of each daily's stories and reads 90% of pages tried (`ingest --coverage`).
- Authority list (D234), shipped off. closed when: Somesh signs off `config/authority.json`, it is on, and a daily airs a lab story with each domain passing at most 30% of its judged items (`authority replay`).
- Run names (D217), Neon run log (D221). closed when: a daily is named `daily <date>`, is off the queue, with `pipeline_runs` rows.
- `.github/workflows/podcast.yml` lost its ffmpeg step in this branch (workflow files need a manual merge). closed when: merged and a Catch up reaches its first stage within 5 s of the runner starting.
- A Regenerate can ask for 3, 5, 10 or 15 minutes (D207): `run.yml` gained a `length_minutes` input, which must merge with the site code or GitHub refuses the dispatch. closed when: a Regenerate at 10 minutes airs within 10% of 10.
- Podcast queue (D231): fakes only; Cancel needs the token's Actions write (unchecked). closed when: the owner runs a Catch up and a regeneration, cancels one, opens the other, and reads a failed run's Details.
- Discovery copies rank below an outlet's own entry in dedupe. closed when: a run's dedupe report keeps the outlet's entry where a discovery copy was found.
- Opus on runners (D198, #381, #388). closed when: an audio run logs `ffmpeg version`, its digest has `m4a_url`, and the owner plays /d/2026-10-24 on an iPhone.
- Alexandria pilot (D200). closed when: a run log shows `anthropic-blog` fetched via `alexandria:anthropic-com` with dated posts.
- Owner's eye: the bar's centring (over 1px), the centred column and label gap (D229), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off.
- Live content (plan 20): an open page elsewhere does not refresh within 60 s; `smokeLive.mjs --apply` never ran on production; offline copies of a removed episode and Listen now after a delete are unaudited. closed when: checked.
- Settings paint the kept store copy at once, the theme before first paint (D205); another device's edit waits for a reload toast; a first visit after a config change waits for the store, up to 2.5 s. closed when: the owner signs off on a phone.
- Sources design (D124) live: production asks Jev for a source's format only after `npm run secrets:push`; no run used a mix, perspective or cap. closed when: a production source's format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl's transcripts answered live (10-24), Gemini 10-19; no full run used either. closed when: a committed digest has a YouTube finalist with `extract_method` captions or transcription.
- YouTube feeds 404 on runners (since 10-14); #235 reads them via Firecrawl. closed when: a run's fetch lists the five in `relayed_sources`.
- D145 to D147, D156 to D159 ([hardening](engineering/hardening.md)): tests only. closed when: a phone app loads a deploy itself (D202), health shows perf and `field` lines, a Monday opens or closes `health-warnings`.
- Downloads (D127) on a phone: the audio fetch against Blob's CORS, Play in airplane mode, a briefing and an episode. closed when: both play offline on a phone after a Download.
- Episode quality (D119, D120), refill (#237, #197): no live spares, refill or one-outlet Science story. closed when: a digest that lost stories in grounding airs within 10% of its length, and one has a one-outlet Science story.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) never ran. closed when: an iPhone and an Android phone each pass it.
- "Narration is not available right now" (10-12): not reproduced. A failing try leaves a `server` fault for `api/narrate`. closed when: one names the step.
- Time zone (D100, D239 prompt) only faked: no non-Stockholm zone, fallback or clock change; `sinceLabel`, `pendingAudio` and `podcast/select` still use Stockholm's today. closed when: a run across the 10-25 clock change publishes on the right day.
- General topics (D66 to D69, D102): no committed digest has a general topic's section yet. closed when: one does.
- Config through `config.yml` never seen live: `topic.scope`, rename or move from the panel, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics (D108, D109), episode delete and regenerate. closed when: each lands as a `main` commit from the site.
- Config store (D149, D185), on since 10-24. closed when: a phone's edit shows on a laptop.
- A pending `config.yml` run can be cancelled by GitHub after a 202 (shared `singularity` group); production's `GITHUB_SINGULARITY_TOKEN` is unchecked since 10-14. closed when: a config save from the site produces a commit.
- A 15 minute episode falls short; the app does not say how much a window holds. closed when: an episode airs within 10% of 15 minutes, or the form shows what the window holds.
- Costs (D137), Firecrawl's week (D166, D222): every price in `config/prices.json` is unconfirmed. closed when: the owner confirms the prices, /analytics shows a real run and a week's runs are all in the ledger.
- Admin (D224) unreachable. closed when: /admin is live and a private window sees sign-in.
- Catch up: 2 of 7 `podcast.yml` runs failed by 10-28, the last too. closed when: the cause is named.
- 35 older items parked: [five](history/2026-10-21-owner-backlog-in-parallel.md#parked), [twelve](history/2026-10-27-session-close.md#parked), [seven](history/2026-10-27-generation-health.md#parked), [eleven](history/2026-10-28-generations-list.md#parked). closed when: each closes.

## Known risks

- Vercel storage near 10 GB (10-24), not narration (4 MB a digest, pruned at 120 days). closed when: explained.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, inside the caps.
- Budget counters can read below real spend; the workflow and site keep separate counters against one Speechify allowance.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces it; closing the tab in the 10 s gap loses it (D79, D91).

## Next

1. Free the lane in the hold ([D209](decisions/engine.md)).
2. Owner: regenerate the 3-story 10-27 briefing? Revoke the Vercel token pasted in chat; delete the empty store `store_JmrDq8MB5Kwn3ejW`; the open calls in [the PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
3. Firecrawl: a per-source yield table for the owner to prune (21 sources gave 1 story per 4,460 credits a month); changelog providers once the pilot holds.
4. Lighthouse: defer BaseLayout's 34 KiB CSS without breaking the bar; the 1.4 s chain.
5. `topic` to `category` end to end (plan 14): an inventory the owner reviews, dual-name readers, a store-synced migration, the rename, workflow outputs, then the old names go; only with no other PR open ([starting points](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
6. Design-system sweep (plan 17): `/settings/*`, category pages, player, create; light and dark at 390 and 1280; one PR per component family.
7. Performance: one fetch for both briefing passes, rewrite only a thin story, split a long first turn (D141, D178).
