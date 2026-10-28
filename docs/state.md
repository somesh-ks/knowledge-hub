# State

Updated 2026-10-28. Rewrite, never append. Behaviour: [specs](specs/README.md). Why: [decisions](decisions.md). Sessions: [history](history/README.md).

## Working

- Engine live end to end (fetch, Jev judge, writer, validate, commit), sized by the owner's length with spares: [engine](specs/engine.md).
- Reader: Latest, Library, Catch up, Settings, `/design`: [library](specs/library.md), [create](specs/create.md), [settings](specs/settings.md), [health](specs/health.md), [look and sound](specs/look-and-sound.md).
- Player as one surface, transcript with word light, chapters in the bar, a queue with Up next (D126): [player](specs/player.md).
- Narration on Play, story by story; `audio.yml` pre-narrates briefings, `podcast.yml` episodes; Opus with an MP3 fallback (D198): [narration](specs/narration.md), [create](specs/create.md).
- Live content: creates, deletes (tombstones) and regenerates show without a deploy (D199).
- Saved-copy navigation, offline shell, downloads for offline listening, the installed PWA: [navigation and offline](specs/navigation-and-offline.md).
- Schedule (D61, D197): generated ahead, published at 07:00.
- Dual-render HTML templates: shared typed markup for Astro and client scripts without islands (D204).
- Vercel deploys `main`. CI: checks, audit, browser suites by path (D148). CodeRabbit reviews PRs (D192); merges by hand (D143).
- Tooling (D38 [roster](history/2026-10-08-subagent-roster.md)): subagents, `/close-session`.

## Tests

Unit (CI): 304 files, 4,957 tests (10-28), 85 s. Site e2e: 396 runs (10-27), 10 min. Player e2e: 77 runs, 6 min.

## Not working or unverified

- Short briefings: 2026-10-27 shipped 3 of 8 stories (grounding dropped 5; #373, #375). closed when: a daily airs within 10% of its length and its drop log names the cause.
- Opus on runners (D198, #381, #388). closed when: the next audio run logs `ffmpeg version` and its digest has `m4a_url`; then the owner plays /d/2026-10-24 on an iPhone before the backfilled MP3s go.
- Alexandria pilot (D200). closed when: a run log shows `anthropic-blog` fetched via `alexandria:anthropic-com` with dated posts.
- Episode length (#327). closed when: a podcast's "Script length" line reaches 90% of its target.
- Owner's eye: the bar's centring (they saw more than 1px), Catch up (#385), card corners (#386), Costs tiles (#387). closed when: signed off on a phone and a laptop.
- Live content (plan 20): an open page elsewhere does not refresh within 60 s; `smokeLive.mjs --apply` never ran on prod; offline copies of removed episode unaudited. closed when: each is built or checked.
- Settings paint the device's copy after a 300 ms grace; another device's edit waits for a reload toast (#382). closed when: the owner picks.
- `topics.spec.ts` near 823 (Add source) failed 1 of 2 cloud runs, passed alone. closed when: a trace names the race or CI runs it clean for a week.
- Sources design (D124) live: production asks Jev for a source's format only after `npm run secrets:push` (a rule guesses first); no run used a mix, perspective or cap. closed when: a production source's format comes from Jev and a digest follows a mix change.
- Software Engineering (D155) live. closed when: a digest has its section.
- YouTube text: Firecrawl's transcripts answered live (2026-10-24), Gemini 2026-10-19; no full run used either. closed when: a committed digest has a YouTube finalist with `extract_method` captions or transcription.
- YouTube feeds 404 on runners (since about 10-14); #235 reads them via Firecrawl. closed when: a run's fetch lists the five in `relayed_sources`.
- D145 to D147, D156 to D159 ([hardening](engineering/hardening.md)): tests only. closed when: a phone app loads a deploy itself (D202), health shows perf and `field` lines, a Monday opens or closes `health-warnings`.
- Downloads (D127) on a phone: the audio fetch against Blob's CORS, Play in airplane mode, a briefing and an episode. closed when: both play offline on a phone after a Download.
- Player tabs and queue (D126, D133): Stories with the live transcript, Up next, the handle drag, the chevron. closed when: each works on a phone and the queue starts the next item at an end.
- Episode pre-narration (D128): no live run; `podcast.yml` calls `audio.yml` (#183); GitHub's `SPEECHIFY_VOICE_ID_B` must match Vercel's. closed when: a new episode's commit is followed by an `audio.yml` run and its turns are in Blob.
- Episode quality (D119, D120), refill (#237, #197): no live spares, refill or one-outlet Science story. closed when: a digest that lost stories in grounding airs within 10% of its length, and one has a one-outlet Science story.
- Taste check (D118): Jev 1.14 live; taste on real candidates; an open from a phone. closed when: a run log shows `taste` answers and an open from a phone reaches the vote batch.
- Covers and header light (D110, D122): monthly covers deployed; the light on a real GPU, Safari, Firefox; a theme switch past 400 ms. closed when: phone and desktop screenshots of production show each.
- Safari and WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) never ran. Checklist: six old failures, drawn selects and sheets (D167), the searchable list, device sounds, the address-bar move (#120). closed when: an iPhone and an Android phone each pass it.
- "Narration is not available right now" (2026-10-12): not reproduced. A failing try leaves a `server` fault for `api/narrate`. closed when: one names the step.
- Time zone (D100) only faked: no non-Stockholm zone, fallback entry or clock change; `sinceLabel`, `pendingAudio` and `podcast/select` still compare with Stockholm's today. closed when: a run across the 2026-10-25 clock change publishes on the right day.
- General topics (D66 to D69, D102): no run judged the general feeds or put a general topic in a briefing; the first fetch of the 21 new sources; a mixed episode. closed when: a digest with a ticked general topic has its section and the judge stage reports the feeds.
- Scoring sample (D70): most sources still New. closed when: two weeks on, under 10% of switched-on sources read New.
- Config through `config.yml` never seen live: `topic.scope`, rename or move from the panel, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics (D108, D109), delete and regenerate an episode. closed when: each op lands as a commit on `main` from the site.
- Config store (D149, D185): on since 2026-10-24; the 2026-10-25 weekly copied it. closed when: a phone's edit shows on a laptop.
- Pending `config.yml` run can cancel after 202; prod token unchecked since 10-14. closed when: a config save from the site produces a commit.
- Live services never called from production: Anthropic, Speechify voice list/samples, `/api/source-preview`, `/api/site-icon`. closed when: each answers once on production.
- Timings (D80 to D82: press to episode about 2.2 min) are from the fixture build. closed when: one real episode is timed against the note.
- A 15 minute episode falls short (71% general, 45% owner topics, 12-story day); the app does not say how much a window holds. closed when: an episode airs within 10% of 15 minutes, or the form shows what the window holds.
- Thresholds untuned: Jev 0.4 and 0.5, Trending clustering, source scores (D55), the vote numbers, `auto_adjust` (D190). closed when: each is checked against the golden set or two weeks of real data.
- Unverified (D106 to D109): the volume slider's linger and drag hold, the highlight's pause on a live briefing, a vote batch sent on unload, a briefing regenerated with a topic its run did not fetch, a custom topic's prefill in Regenerate. closed when: each is seen once on production.
- Costs (D137) and Firecrawl's week (D166): every price in `config/prices.json` is unconfirmed; the 10-24 run is the ledger's first. closed when: the owner confirms the prices, /analytics shows a real run and a week's runs are all in the ledger.
- [Analytics](specs/analytics.md) (D154). closed when: a live page view, `share` and `listen_half` show up.
- Catch up: 2 of 7 `podcast.yml` runs failed by 10-28, the last too. closed when: the cause is named.
- No island at first load (D178). closed when: the owner's phone shows the bar promptly after a first Play.

## Known risks

- Vercel storage near 10 GB (2026-10-24), unexplained by narration (4 MB a digest, pruned at 120 days). closed when: explained.
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
