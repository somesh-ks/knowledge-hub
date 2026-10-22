# State

Last updated 2026-10-22. Rewrite; do not append. Behaviour: [specs/](specs/README.md). Why: [decisions.md](decisions.md). Sessions: [history/](history/README.md).

## Working

- Engine end to end on live services (fetch, Jev judge, writer, validate, commit), sized by the owner's length with spares: [engine](specs/engine.md).
- Reader: Latest, Library (row menu, downloads), New episode, Settings, in a tonal Material 3 look: [library](specs/library.md), [create](specs/create.md), [settings](specs/settings.md), [look and sound](specs/look-and-sound.md).
- Player as one surface, transcript with word light, chapters in the bar, a play queue with Up next (D126): [player](specs/player.md).
- Narration on Play, story by story; briefings are pre-narrated by `audio.yml` after each run; episodes through `podcast.yml`: [narration](specs/narration.md), [create](specs/create.md).
- Saved-copy navigation, offline shell, downloads for offline listening and the installed PWA: [navigation and offline](specs/navigation-and-offline.md).
- Deploy: Vercel deploys `main`. CI (PRs only): checks, gitleaks, audit; browser suites by path (D148). Dependabot PRs auto-merge; others by hand (D143).
- Tooling (D38, [roster](history/2026-10-08-subagent-roster.md)): ten subagents, `/close-session`, a read-only Bash hook. Untested: per-call `effort`, `omitClaudeMd`, `ui-critic`.

## Tests

Unit (`npm test`, CI): 256 files, 4,748 tests on 2026-10-19, about 85 s here. Site e2e: 356 runs on 2026-10-14, about 8 minutes. Player e2e: 70 runs, about 5.5 minutes.

## Not working or unverified

- Sources design (D124) live: production asks Jev for a source's format only after `npm run secrets:push` (a rule guesses until then); no run used a mix, perspective or the outlet cap. closed when: an added source's format comes from Jev on news.someshks.work and a digest follows a mix change.
- Software Engineering (D155) live. closed when: a digest has its section.
- YouTube text: captions and Gemini worked on live videos (2026-10-19); no full run used them. closed when: a committed digest has a YouTube finalist with `extract_method` captions or transcription.
- D145 to D147, D156 to D158 ([hardening](engineering/hardening.md)): tests only. closed when: a phone gets the deploy toast; health shows perf and `field` lines; a Monday opens or closes the `health-warnings` issue.
- Downloads (D127) on a real phone: the audio fetch against the Blob host's CORS, Play in airplane mode, a briefing and an episode. closed when: both play offline on a phone after a Download.
- Player tabs and queue (D126, D133): Stories with the live transcript, Up next as a tab, the handle drag, the chevron. closed when: each works on a phone and the queue starts the next item at an end.
- Episode pre-narration (D128): no live run; `podcast.yml` calls `audio.yml` since #183, and `SPEECHIFY_VOICE_ID_B` on GitHub must match Vercel's. closed when: a new episode's commit is followed by an `audio.yml` run and its turns are in Blob.
- `?view=preferences` (D129) may flash Sources on load. closed when: a reload on a phone shows no Sources frame first.
- Topic emoji from Jev (D133) never asked live. closed when: a topic added on news.someshks.work shows an emoji Jev chose.
- D125: pull to close, sticky tabs, keyboard fit. closed when: each works on phone.
- Live runs of the 2026-10-18 changes (chapters seen): release news last, the sized weekly. closed when: a daily files Launches last; a Sunday weekly airs within 10% of 15 minutes.
- Episode quality (D119, D120): a live run with spares and a one-outlet Science story. closed when: a committed digest has a Science story from one outlet and airs within 10% of its length.
- Taste check (D118): Jev 1.14 live, taste answers on real candidates, an open from a real phone. closed when: a run log shows `taste` answers and an open from a phone reaches the vote batch.
- PWA (D123) on a device: Android bars after a reinstall, splash to launch-screen hand-off. closed when: both match the theme after an Android reinstall.
- Covers and header light (D110, D122): monthly covers on the deployed site; the light on a real GPU, Safari and Firefox; a theme switch past 400 ms. closed when: phone and desktop screenshots of production show each.
- Real phones, Safari, WebKit: the iPhone `@smoke` set (`PLAYER_WEBKIT=1`) never ran. Checklist: its six old failures (flick up, long pull, three stuck paths, cover flight), drawn selects, the searchable list, device sounds, the address-bar move (#120). closed when: an iPhone and an Android phone each pass it.
- "Narration is not available right now" (2026-10-12): not reproduced. A failing try leaves a `server` fault for `api/narrate`. closed when: one names the step.
- Scheduled trigger (D61): no 07:00 dispatch from Vercel Cron seen since `CRON_SECRET` was set (2026-10-13). closed when: the Cron Jobs page shows a 07:00 call that started `run.yml`.
- Time zone (D100) only against fakes: not a non-Stockholm zone, a fallback entry or a clock change; `sinceLabel`, `pendingAudio` and `podcast/select` still compare with Stockholm's today. closed when: a run across the 2026-10-25 clock change publishes on the right day.
- General topics (D66 to D69, D102): no run judged the general feeds or put a general topic in a briefing; the first fetch of the 21 new sources; a mixed episode. closed when: a digest with a ticked general topic has its section and the judge stage reports the feeds.
- Scoring sample (D70): most sources still New. closed when: two weeks on, under 10% of switched-on sources read New.
- Config through `config.yml` never seen live: `topic.scope`, rename or move from the panel, a batch adding a topic with sources, a blocked domain, votes, Regenerate with topics (D108, D109), delete and regenerate an episode. closed when: each op lands as a commit on `main` from the site.
- Config store (D149): built, off; switch-on is runbook 11.1, seed with replace first. closed when: a phone's edit shows on a laptop and a run log names the store.
- A pending `config.yml` run can be cancelled by GitHub after a 202 (shared `dispatch` group); production's `GITHUB_DISPATCH_TOKEN` is unchecked since 2026-10-14. closed when: a config save from the site produces a commit.
- Live services never called from production: Anthropic, the Speechify voice list and samples, `/api/source-preview`, `/api/site-icon`. closed when: each answers once on news.someshks.work.
- Timings (D80 to D82: press to episode about 2.2 min) are from the fixture build. closed when: one real episode is timed against the history note's map.
- A 15 minute episode falls short (71% general, 45% owner topics on a 12-story day); the app does not say how much a window holds. closed when: an episode airs within 10% of 15 minutes, or the form shows what the window holds.
- The first press on a cold audio device blocks about 200 ms (`new AudioContext()` in `packages/sound`). closed when: the owner decides whether to change that package's first rule.
- The daily Type is saved but not applied (narration reads the digest in one voice). closed when: the owner decides on a podcast step in `audio.yml` or drops the field.
- With a mouse a story chip grows 11px from idle to played (it reserves "Play again"). closed when: the chip keeps one width in a browser assertion.
- On a 360x740 phone the sticky Generate bar covers More options on `/create` at rest. closed when: axe reports no obscured target there.
- An aggregator's or redirect's link to a blocked outlet is not caught. closed when: matching resolves the final URL, or the owner accepts it.
- Thresholds untuned: Jev 0.4 and 0.5, Trending clustering, source score thresholds (D55), the vote numbers (15%, 3 votes, 30 days). closed when: each is checked against the golden set or two weeks of real data.
- Settings logic gaps (D102): a partial `skip_topics` without `general_scoped` un-skips general topics (the site never sends it); `topic.enabled` is never set false (dead branches); Edit topic sends the build's weight, not a pending edit. closed when: each is fixed or removed with a test.
- Unverified (D106 to D109): the volume slider's 400 ms linger and hold while dragged (CSS only), the highlight's pause on a live briefing, a vote batch sent on unload (a lost one is not retried), a briefing regenerated with a topic its run did not fetch, a custom topic's prefill in Regenerate. closed when: each is seen once on production.
- Costs (D137): every price in `config/prices.json` is unconfirmed and no run has filled the ledger. closed when: the owner confirms the prices and /analytics shows a real run.
- Model orchestrator (D136): never run live. closed when: a run log names the resolved models.
- `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`, and no end-to-end test applies a real op array through `config apply`. closed when: both exist.
- [Analytics](specs/analytics.md) (D154). closed when: a live page view, `share` and `listen_half` show up.
- Five older items are [parked](history/2026-10-21-owner-backlog-in-parallel.md#parked). closed when: each closes.

## Known risks

- With the passphrase off (D41), anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps.
- Budget counters can read below real spend (an edit that does not lengthen a briefing, two charges at once, a function killed mid-synthesis); the workflow and the site keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- A save made while a briefing runs waits in the `dispatch` queue, and a later save replaces an earlier waiting one; closing the tab in the 10 s gap loses it (D79, D91).

## Next

1. Owner: revoke the Vercel token pasted in chat on 2026-10-07 and replace the `.env` one; delete the empty Blob store `store_JmrDq8MB5Kwn3ejW`; decide: general topics start ticked? a photograph for a topic's picture? a group override (emoji, More menu) for the four groups? briefings as discussions? and the open calls in [the PWA note](history/2026-10-16-pwa-launch-and-one-model-select.md) (iOS startup images, the iOS light status bar) and in the cost note (`git show 91bc533:docs/state.md`) (feeds for 17 sources, `MAX_TEXT_CHARS`).
2. Parked by the owner (2026-10-14): no island eager at first load (cut 1 in [first-load-js.md](engineering/first-load-js.md), about 73 KB). Do not build it until asked.
3. Performance: one fetch for both briefing passes, rewriting only a thin story, splitting a long first narrated turn, a shallow workflow checkout; the first-load cuts (item 2) within 130 KB (D141).
4. Workflow changes: finer episode stages (the podcast command in phases); Firecrawl filling a gap in an owner topic for an episode (`podcast.yml` has no Firecrawl key).
5. Set `SPEECHIFY_VOICE_ID_B` on GitHub (or `npm run secrets:push`).
6. Calibrate the Jev thresholds on the golden set (`eval/run.ts --only judges`); apply the source pass-rate nudge in the `curate` path; one generated briefing to see Design and Trending, then tune the Trending threshold.
7. Tests left by the D99 cuts, only if they cost less than they save: `gate-decideRun` DST cases, `voice-lint`, the `heldSave` and `readerContract` tables, the Library filter table.
