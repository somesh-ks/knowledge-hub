# State

Updated 2026-10-28. Rewrite, never append. Behaviour: [specs](specs/README.md). Why: [decisions](decisions.md). Sessions: [history](history/README.md).

## Working

- Engine live end to end (fetch, Jev judge, writer, validate, commit), sized by the owner's length with spares: [engine](specs/engine.md). A run that loses stories or races another run's push degrades instead of failing, and each run records its health (D204): [resilience](engineering/generation-resilience.md), [metrics](engineering/metrics.md).
- Reader: Latest, Library, Catch up, Settings, tonal Material 3, `/design` catalogue: [library](specs/library.md), [create](specs/create.md), [settings](specs/settings.md), [look and sound](specs/look-and-sound.md).
- Player as one surface, transcript with word light, chapters in the bar, a queue with Up next (D126): [player](specs/player.md).
- Narration on Play, story by story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes; Opus with an MP3 fallback (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199). A Regenerate and a Catch up are followed in one run card; a failed run says why (D204). Every generation under way is listed with Cancel, in a popover from the side column's icon and a sheet on a phone (D208).
- Saved-copy navigation, offline shell, downloads for offline listening, the installed PWA: [navigation and offline](specs/navigation-and-offline.md).
- Schedule (D61, D197): generated ahead, published at 07:00.
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews PRs (D192); merges by hand (D143).
- Tooling (D38 [roster](history/2026-10-08-subagent-roster.md)): subagents, `/close-session`.

## Tests

Unit (CI): 311 files, 5,010 tests (10-28), 86 s. Site e2e: 411 runs (10-28), 10 min. Player e2e: 77 runs, 6 min.

## Not working or unverified

- Short briefings and lost runs (D204): the 2026-10-27 Regenerate aired 2 of 5 minutes and its Catch up lost its episode to a push conflict; the fixes have only run against fakes. closed when: `singularity metrics` has ten runs with `length_share` at 0.9 and `failure_rate` at 0.1 or less, and a Regenerate pressed during a Catch up publishes both.
- `.github/workflows/podcast.yml` lost its ffmpeg step in this branch (workflow files need a manual merge). closed when: the owner merges it and a Catch up reaches its first stage within 5 s of the runner starting.
- A Regenerate can ask for 3, 5, 10 or 15 minutes (D207): `run.yml` gained a `length_minutes` input, which must merge with the site code or GitHub refuses the dispatch. closed when: a Regenerate at 10 minutes airs within 10% of 10.
- Generations list and Cancel (D208): only against fakes. `POST /api/cancel` needs the token's Actions write (unchecked since 2026-10-14); a cancelled Catch up leaves its live copy "writing" for the 24 h prune and, stopped while recording voices, loses that run's usage charge; a briefing's time left needs three timed runs in `state/run-metrics.json` (none yet). closed when: the owner cancels a real Catch up from the list, it ends as Cancelled, and a briefing shows a time left.
- Not built: a length option above 15 minutes (the 19,000-character narration request is full at 15). closed when: the owner asks for it.
- Discovery copies rank below an outlet's own entry in dedupe (2026-10-28). closed when: a run's dedupe report keeps the outlet's entry where a discovery copy was found.
- Opus on runners (D198, #381, #388). closed when: an audio run logs `ffmpeg version`, its digest has `m4a_url`, and the owner plays /d/2026-10-24 on an iPhone.
- Alexandria pilot (D200). closed when: a run log shows `anthropic-blog` fetched via `alexandria:anthropic-com` with dated posts.
- Episode length (#327). closed when: a podcast's "Script length" line reaches 90% of its target.
- Owner's eye: the bar's centring (they saw more than 1px), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off on a phone and a laptop.
- Live content (plan 20): an open page elsewhere does not refresh within 60 s; `smokeLive.mjs --apply` never ran on production; offline copies of a removed episode and Listen now after a delete are unaudited. closed when: each is built or checked.
- Settings paint the kept store copy at once and the theme before first paint (D205); another device's edit waits for a reload toast; a first visit after a config change still waits for the store, up to 2.5 s. closed when: the owner signs off on a phone.
- Sources design (D124) live: production asks Jev for a source's format only after `npm run secrets:push` (a rule guesses first); no run used a mix, perspective or outlet cap. closed when: a production source's format comes from Jev and a digest follows a mix change.
- YouTube text: Firecrawl's transcript provider answered live (2026-10-24), Gemini on 2026-10-19; no full run used either. closed when: a committed digest has a YouTube finalist with `extract_method` captions or transcription.
- YouTube feeds answer the runners 404 (since about 10-14); #235 reads them through Firecrawl. closed when: a run's fetch lists the five in `relayed_sources`.
- D145 to D147, D156 to D159 ([hardening](engineering/hardening.md)): tests only. closed when: a phone app loads a deploy itself (D202), health shows perf and `field` lines, a Monday opens or closes `health-warnings`.
- Downloads (D127) on a real phone: the audio fetch against Blob's CORS, Play in airplane mode, a briefing and an episode. closed when: both play offline on a phone after a Download.
- Episode quality (D119, D120) and the refill (#237, #197): a live run with spares, a refill and a one-outlet Science story. closed when: a digest that lost stories in grounding airs within 10% of its length, and one has a Science story from one outlet.
- Real phones, Safari, WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) never ran. Checklist: six old failures, drawn selects and sheets (D167), the searchable list, device sounds, the address-bar move (#120). closed when: an iPhone and an Android phone each pass it.
- "Narration is not available right now" (2026-10-12): not reproduced. A failing try leaves a `server` fault for `api/narrate`. closed when: one names the step.
- Time zone (D100) only against fakes: not a non-Stockholm zone, a fallback entry or a clock change; `sinceLabel`, `pendingAudio` and `podcast/select` still compare with Stockholm's today. closed when: a run across the 2026-10-25 clock change publishes on the right day.
- General topics (D66 to D69, D102): no run judged the general feeds or put a general topic in a briefing; the first fetch of the 21 new sources; a mixed episode. closed when: a digest with a ticked general topic has its section and the judge stage reports the feeds.
- Config through `config.yml` never seen live: `topic.scope`, rename or move from the panel, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics (D108, D109), delete and regenerate an episode. closed when: each op lands as a commit on `main` from the site.
- Config store (D149, D185): on since 2026-10-24; the 2026-10-25 weekly copied it. closed when: a phone's edit shows on a laptop.
- A pending `config.yml` run can be cancelled by GitHub after a 202 (shared `singularity` group); production's `GITHUB_SINGULARITY_TOKEN` is unchecked since 2026-10-14. closed when: a config save from the site produces a commit.
- A 15 minute episode falls short (71% general, 45% owner topics, 12-story day); the app does not say how much a window holds. closed when: an episode airs within 10% of 15 minutes, or the form shows what the window holds.
- Costs (D137) and Firecrawl's week (D166): every price in `config/prices.json` is unconfirmed; the 10-24 run is the ledger's first. closed when: the owner confirms the prices, /analytics shows a real run and a week's runs are all in the ledger.
- Thirty older items are parked: [five](history/2026-10-21-owner-backlog-in-parallel.md#parked), [twelve](history/2026-10-27-session-close.md#parked), [seven](history/2026-10-27-generation-health.md#parked), [six](history/2026-10-28-generations-list.md#parked). closed when: each closes.

## Known risks

- Vercel showed storage near 10 GB (2026-10-24); narrations (4 MB a digest, pruned at 120 days) do not explain it. closed when: explained.
- No passphrase (D160): anyone with the URL can run, narrate, delete and edit config, inside the caps.
- Budget counters can read below real spend (an edit that does not lengthen a briefing, two charges at once, a function killed mid-synthesis); the workflow and the site keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- A save made while a briefing runs waits in the `singularity` queue; a later save replaces an earlier waiting one; closing the tab in the 10 s gap loses it (D79, D91).

## Next

1. Owner: regenerate the 3-story 2026-10-27 briefing? Revoke the Vercel token pasted in chat (2026-10-07); delete the empty store `store_JmrDq8MB5Kwn3ejW`; the open calls in [the PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md).
2. Firecrawl: a per-source yield table (21 scraped sources gave about 1 published story per 4,460 credits a month) for the owner to prune; changelog providers (Claude, OpenAI release notes) once the pilot holds.
3. Lighthouse: defer BaseLayout's 34 KiB CSS without breaking the resumed bar; the 19 KiB unused; the 1.4 s chain (share, overlays and Create tools on interaction). Re-run after any CSS change.
4. `topic` to `category` end to end (plan 14, about 6,500 occurrences): an inventory the owner reviews, dual-name readers, a store-synced migration, the code rename, workflow outputs, then drop the old names; only with no other PR open ([starting points](history/2026-10-25-owner-feedback-pass.md#left-out-for-a-later-session)).
5. Design-system sweep (plan 17): `/settings/*`, category pages, player, create; light and dark at 390 and 1280; one PR per component family.
6. Performance: one fetch for both briefing passes, rewrite only a thin story, split a long first turn (D141, D178).
