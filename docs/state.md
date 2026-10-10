# State

Last updated 2026-10-10. Rewrite this file; do not append.

The reader is called Singularity (D30). Identifiers keep `dispatch`. Everything below is on `main` and deployed at news.someshks.work unless a line says otherwise. The design pass of 2026-10-10 (D51, D52, and the lines that name them) is on the branch `claude/charming-sagan-m6evyy`, pushed and not yet merged.

## Working in production

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius), validate, commit as the owner.
- Vercel deploys the site from the Git integration. CI on Linux: typecheck, lint, tests, site build, gitleaks (with `.gitleaks.toml` allowing the invented values tests assert on). Auto-merge for owner and Dependabot PRs.
- Reader in the visual language of Google Podcasts (D31): Today, Library, Create, Settings. Library filters are All, Daily, Weekly, Custom; Custom holds everything made on request.
- Player as one surface from the bottom bar to a full page (D32, D50), with seek, a clock and volume on wide screens. The whole bar opens it; a drag, the bar, Back or Escape close it (no chevron; a "Close the player" button shows only on keyboard focus). The open page: cover, title, story and source; the five transport controls on one axis with a speed pill under play on a phone, and the two skips with the speed between them on a wide screen with a mouse. The speed opens a slider from 0.5x to 2x in steps of 0.05; on the branch it is a modal dialog (under the pill on a phone, above it with a mouse) with 1x, 1.25x, 1.5x and 2x presets, any step is remembered, Back closes the open player instead of leaving the page, and the desktop bar's line has a notch at the playhead. Timeline markers are one small dot per story. An episode with chapters gets a Chapters / Transcript switch; the transcript reads like Speechify (said words in full ink, the rest muted, the spoken word on a soft fill) from Speechify's word marks, with an estimate where a segment has none.
- Narration on Play, story by story (D33).
- Custom episodes (D37): the first real run of `podcast.yml` succeeded on 2026-10-08 and published `ep-20261008-1155`. Discussion episodes use a second voice by default (`dominic_32`). Twelve episodes a day, two minutes apart.
- Episode length: the writer is told the length in words and a script is held to what its stories can carry. Real dry runs on 2026-10-08 put 5 and 10 minute episodes at 83 to 90% of the length asked for (they were at 25 to 67%). `dispatch podcast --dry-run` measures one request without writing.
- Delete an episode, or regenerate it with feedback, from a three-dots menu on the episode page (D44). Both go through `/api/podcast` and `podcast.yml`. A delete takes effect at once on the device that asked: the episode is hidden there while the workflow and the redeploy finish.
- Nothing is said under the play chip before audio exists. Space plays and pauses from anywhere once the bar is there. The first Play on a page with no audio starts by itself (it used to spin until a second press).
- Moves between Today, Library, Create and Settings are answered from a copy the service worker saved in the last ten minutes and swapped at once (D47). Measured on production on 2026-10-09, medians on desktop and phone: the page arrives in 2 ms (was 26), the new page is on screen in 32 ms (was 70) and fully drawn in 132 ms (was 407). The current destination is marked the moment it is pressed.
- Model in Settings (D46): the writer's provider (Nebius) and model, with a filter over the live list. The engine tries the chosen model first and falls back to the two variables.
- One top rhythm across the four destinations, held to 1px by `e2e/rhythm.spec.ts`; a sliding thumb on segmented controls; every page can scroll its last control clear of the floating button. On the branch every select (Settings, Library sort, Create) opens one drawn list set in `primitives.css` through `appearance: base-select` (Chromium 135+, Safari 27; native lists elsewhere), opening below its field when it fits.
- Ambient cover light (D48): a soft light in the cover's colours behind the header of Today and of an episode, drawn by a small WebGL canvas on a GPU and by a CSS layer everywhere else.
- Schedule in Settings (D45): hour, cadence and topics of the scheduled briefing. The Create audience "Customized" is called "Somesh mode".
- Create is the primary action: a side button on wide screens, a floating button on phones, a panel for the form (full screen on a phone, a side panel on desktop) and a compact progress indicator. On the branch (D52) the phone button shows only on Today and the Library, extended (plus and "Create") at the top and while scrolling up and folded while scrolling down; pressing the tab of the page you are on scrolls it to the top. Enter in Create's Title puts the keyboard away instead of starting a run, and the Create panel closes only on a press that began on its scrim.
- General episodes built from 24 general-news feeds, ranked by coverage, with their own topics (D43).
- One Jev request per item and a per-run Firecrawl ceiling of 30 (D42).
- The site's GitHub token reaches the repository since 2026-10-08; before that Create, Generate and config saves all failed.
- The passphrase step is switched off (D41). Caps, cooldowns and the narration budget stay enforced.
- Five topics with Top picks always included, General and Customized audiences (D39); Design and Trending ship with the app, Trending ranked by coverage, discovery only suggests (D40); a 44-entry source catalogue feeds the add-topic flow.

- Making something shows live stages in the run indicator: seven for a briefing (one per workflow step, then "Updating the site"), three for an episode ("Getting ready", "Making the episode", "Updating the site"; `podcast.yml` makes the whole episode in one step, so nothing finer is shown). Toasts share one quiet style with an icon for success and failure.
- Interface sounds by kind of action (navigate, select, open and close, success, failure) through one delegated listener that loads the sound code on the first gesture and follows the Sounds setting.
- Today and episode pages carry one three-dots menu (Share, Regenerate, Delete on an episode); an episode page shows Highlights with links, not the script. The Library has a List view, search inside episode scripts, and a play button on covers. On the branch (D51) Settings is two levels: an index (Daily, Weekly, Custom, Topics and Model rows with a one-line summary each; Interface sounds; Appearance; About) and one page per job, each titled with a breadcrumb ("Settings › Daily"); Topics lists one page per topic. Changes save themselves (`scripts/autosave.ts`): 1.2 s after the last change, at most 8 ops a request, a removal waits 5 s with Undo, status in the app's toast, and the toast keeps the control just changed in sight. Old addresses redirect (`astro.config.mjs`). Form fields have a 3:1 outline and, in the player, only Play is in full ink (D54).
- Style tests forbid raw lengths for spacing, type size and radius, and reading a custom property nothing defines. The view transition overlay lets the pointer through, so the cursor does not flicker over a link.
- Create panel (2026-10-10): Somesh (not "Somesh mode"), no topic limit (a guard of 50 in `PODCAST_MAX_TOPICS`), no helper text under Written for or Topics, Title says "Optional" beside it, Format is a segmented choice (Readout, Discussion; Headlines is gone from new requests), and the button reads "Generate • 10 mins".
- Writer providers (D49): Nebius and Anthropic (Claude Sonnet 5.5, Haiku 5.5), chosen with a vendor select and a model combobox. A failed Anthropic pick falls through to the Nebius environment models.
- Schedule profiles: `config/schedule.json` holds the Daily fields, a `weekly` profile (day, hour, type, length, voices, on/off) and a `custom` profile (the Create panel's defaults). The engine's weekly run follows its own day, hour and length.
- Sources: a 0 to 5 score from the 30 day stats (Excellent, Good, Fair, Poor, New under 10 judged items) and `GET /api/source-preview` (name, favicon, feed, latest post, score) behind an SSRF guard.
- Voices: `GET /api/voices`; custom episodes are narrated in the voices of their request, briefings in the schedule's (a schedule change reaches Play after a redeploy).
- The writer is told the hosts are Ada and Leo. Settings: no default-speed row (the player keeps the last speed), "Interface sounds", dividers inside the content. A press never scales a label control (`pressText.test.ts`). The player lab pages are in `astro dev` only.

## Written, not merged

- The design pass of 2026-10-10 on `claude/charming-sagan-m6evyy` (D51, D52, D53; the lines that name them). No pull request is open. The preact/compat prototype (about 57 KB off every page) was declined by the owner on 2026-10-10: React stays, and the budget is 110 KB (D53).

## Development

- `npm run dev` shows the Agentation toolbar for leaving notes on elements. It is behind `import.meta.env.DEV`, and `checkBundle` fails any build that contains it. Stop the dev server when done: one left running across an install serves broken islands.

## Tooling (D38)

- Ten subagents are defined (eight user level, `dispatch-verify` and `dispatch-worker` in `.claude/agents/`), plus the `/close-session` skill and a read-only Bash hook. Settings add a 1 hour subagent cache and a cap of 4 concurrent agents at depth 1.
- Verified in a fresh session (agent files load at session start): `reviewer` is blocked on `rm` and on `>` by the hook and has no Write tool; `Explore` has only Read, Grep, Glob, Bash; `general-purpose` runs Sonnet 5.5 without the Agent tool; `dispatch-verify` passed typecheck, 3,686 tests, lint and the static build (100.6 of 102 KB).
- Untested: the per-call `effort` override, the `omitClaudeMd` saving, `researcher`'s Firecrawl tool names and post cap, `ui-critic`. `general-purpose` was restricted to core tools and web after one trivial call cost about 289k subagent tokens with every MCP family loaded (`Explore` and `reviewer` cost 9k and 14k); the new tool list is untested until a session restart. `scout` was retired.
- Lint exit code was not captured by `dispatch-verify`; its pass rests on Biome's summary line.

## Not working or unverified

- Not yet run through the real workflow: deleting an episode and regenerating one.
- The Model page lists only the saved model and a typed id until `NEBIUS_API_KEY` is on Vercel (owner: `npm run secrets:push`). The Nebius call from Vercel and a real `writer.set` through `config.yml` are unverified.
- Unverified on a real deploy: the quiet refresh of a page that changed behind a saved copy, and a new `/latest.json` making saved pages old. Both are covered by unit tests only.
- The first press after opening the app blocks for about 200 ms on a cold audio device (75 ms warm): `new AudioContext()` runs inside the press in `packages/sound`. Moving it changes that package's first rule, so it waits for the owner.
- The ambient light's canvas is unseen on a real phone, in Safari and in Firefox, and its frame cost is unprofiled. Its GPU tests skip in headless Chromium, so CI covers only the CSS layer and the decision not to draw.
- The press, hover and focus audit of every pressable was done in the design pass (two audits, see the 2026-10-10 history note). The Settings switches show the track colour until the page's script is ready.
- A 15 minute episode still falls short: 71% for a general readout with 30 stories, and 45% for the owner's topics on a day with 12 stories, where there is not enough material. The app does not yet say how much a window holds.
- The schedule's hour: the workflow change is merged and, since 2026-10-09, the site's GitHub token can read and write repository variables (checked with the token itself: `RUN_CRON` was created with the default `13 7 * * *`). Not yet seen: a save from Settings, Schedule changing the variable, and a scheduled run firing at a chosen hour. Until a time is saved the briefing stays at 07:13.
- Prewarming the first audio segments on page open is written but not merged: it made the site suite fail, because the background request reaches the test server.
- Left from the QA sweep of 2026-10-08: a Play tap before the page's scripts load is lost on a phone; a refused narration (429) shows no wait time; focus on opening the player is unchecked. The failed-run styling and the phone run bar were changed but not looked at.
- Not yet run against live services: the Design and Trending topics in a real briefing (the Trending clustering threshold is untuned on real headlines), a config batch through `config.yml` (adding a topic with ticked sources), Exa source discovery, the second voice, first-time narration of a new briefing.
- GitHub fired the scheduled run 6.5 hours late on 2026-10-07 and had not fired it by midday on 2026-10-08. The gate compares dates, so a late run still lands on its day, but the time is not dependable.
- No end-to-end test applies a real op array through `config apply`, and none runs a full pipeline with Trending feeds.
- `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`.
- Failing on main and fixed on the branch: `layout.spec.ts` "nothing scrolls sideways at 320px" (/library was 324px wide) and the two `uiSounds.spec.ts` site tests (they looked for the switch by its section's name). The flick tests in `gestures.spec.ts` (flick up, flick down, cover pull) failed about half the time in the cloud container, on untouched code too; on the branch the test finger states each event's time and a mouse drag arrives as small moves (`lab.ts`), and they pass every repeat.
- The player suite on the Chromium site projects passes on main as of 2026-10-10 (the two regressions were a hero cover that started a native image drag and a modal scope that left the page behind reachable by Tab; #42). Six tests fail in WebKit on the unchanged code: a flick up and a long pull up on the bar do not open the page, three "stuck" paths (after Back, after the toast's Open action, when the lazy half cannot load), and the cover flight check. In WebKit a mouse stands in for the finger, so this may be the stand-in and not Safari; only a real iPhone settles it.
- `src/player/dev/LabGlyph.astro` is unused. Delete it when convenient.
- Not tested on a real iPhone.
- Audio stored for the briefings of 6 and 7 October says "Dispatch". It lives in each briefing's front matter, so Play uses it and does not re-make it.

- Owner steps: add `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}` to every step with `NEBIUS_API_KEY` in `run.yml` and `podcast.yml`; for a weekly run at its own hour let the job's `if` accept a `RUN_CRON_WEEKLY` variable (`13 <hour> * * <day>`) that the site would set beside `RUN_CRON`. Until then the weekly follows the daily hour. The `VERCEL_TOKEN` in `.env` is probably dead (it is also the `audio.yml` secret).
- The daily briefing's Type is saved but not applied: narration is built from the digest verbatim, so Discussion needs a podcast step in `audio.yml` (a workflow change). Length does scale the story count.
- Unverified live: any Anthropic call, the Speechify voice list and voice samples (`media-src` may block the sample URLs), `/api/source-preview` and `/api/site-icon` on real feeds, the Nebius shortlist against the live list. The drawn select lists are checked in Chromium screenshots only; Safari 27 and a real phone are unseen.
- `audio-speechify.test.ts` flakes under load (passes alone). `SettingsSheet.tsx` (reachable only from the dev lab) still has a Default speed.
- Covers are served as lossless WebP (pixel-identical, about a third of the PNG bytes; Library images 66 to 20 KB on a phone), encoded with sharp at build time and cached beside the PNG. The PNG is still built for the lock screen's media controls. The section tabs test "follow the page again after a client-side navigation" flakes about 1 in 4 in the cloud container on main.
- Bundle: the budget is 110 KB since D53 (was 104), kept as low as the code allows; the heaviest page is /library at 102.7 on main and 103.1 on the branch (the Podcast editor loads after first paint since #63). React is 68 of the 101 KB every page shares. What could still come off, with sizes (React only when there is something to show, about 76 KB off a first visit; the open-player machinery on first play, about 4 KB), is in [first-load-js.md](first-load-js.md) with the per-chunk tables and a throttled phone run.
- A leftover folder `.claude/worktrees/agent-aa3d6c40ca7009eee` could not be deleted (something holds it); it is not a git worktree.

## Known risks

- With the passphrase off, anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps (D41).
- Budget counters can read below real spend in narrow cases: an edit that does not lengthen a briefing, two briefings charged in the same instant, a function killed mid-synthesis. The engine workflow and the site function keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- `podcast.yml` and `config.yml` push to main beside `run.yml`; the push rebases and retries, which has not been exercised.
- Every session builds into `apps/web/dist`; two sessions running browser suites at once give false failures.

## Next

1. Owner: the two workflow edits above; revoke the Vercel token pasted in chat on 2026-10-07 and replace the `.env` one; delete the empty Blob store `store_JmrDq8MB5Kwn3ejW`.
2. Finer episode stages (the podcast command in phases, a workflow change); the daily Type through the audio workflow.
3. One generated briefing to see Design and Trending, then tune the Trending threshold; two iPhone passes with the six WebKit failures as the checklist.
4. Curation: calibrate the 0.4 threshold on the golden set (needs judge keys: `eval/run.ts --only judges`); apply the source pass-rate nudge in the `curate` path too. Done in #65: one release per repository, only published items marked seen, a source pass-rate nudge in the run path.
