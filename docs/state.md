# State

Last updated 2026-10-09. Rewrite this file; do not append.

The reader is called Singularity (D30). Identifiers keep `dispatch`. Everything below is on `main` and deployed at news.someshks.work unless a line says otherwise.

## Working in production

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius), validate, commit as the owner.
- Vercel deploys the site from the Git integration. CI on Linux: typecheck, lint, tests, site build, gitleaks (with `.gitleaks.toml` allowing the invented values tests assert on). Auto-merge for owner and Dependabot PRs.
- Reader in the visual language of Google Podcasts (D31): Today, Library, Create, Settings. Library filters are All, Daily, Weekly, Custom; Custom holds everything made on request.
- Player as one surface from the bottom bar to a full page (D32), with seek, a clock and volume on wide screens. The whole bar opens it. The open player has one quiet row for speed (one button that steps through the speeds) and the story's source; on a wide screen with a mouse the page keeps the scrubber and the two skips and leaves previous, play and next to the bar.
- Narration on Play, story by story (D33).
- Custom episodes (D37): the first real run of `podcast.yml` succeeded on 2026-10-08 and published `ep-20261008-1155`. Discussion episodes use a second voice by default (`dominic_32`). Twelve episodes a day, two minutes apart.
- Episode length: the writer is told the length in words and a script is held to what its stories can carry. Real dry runs on 2026-10-08 put 5 and 10 minute episodes at 83 to 90% of the length asked for (they were at 25 to 67%). `dispatch podcast --dry-run` measures one request without writing.
- Delete an episode, or regenerate it with feedback, from a three-dots menu on the episode page (D44). Both go through `/api/podcast` and `podcast.yml`. A delete takes effect at once on the device that asked: the episode is hidden there while the workflow and the redeploy finish.
- Nothing is said under the play chip before audio exists. Space plays and pauses from anywhere once the bar is there. The first Play on a page with no audio starts by itself (it used to spin until a second press).
- Moves between Today, Library, Create and Settings are answered from a copy the service worker saved in the last ten minutes and swapped at once (D47). Measured on production on 2026-10-09, medians on desktop and phone: the page arrives in 2 ms (was 26), the new page is on screen in 32 ms (was 70) and fully drawn in 132 ms (was 407). The current destination is marked the moment it is pressed.
- Model in Settings (D46): the writer's provider (Nebius) and model, with a filter over the live list. The engine tries the chosen model first and falls back to the two variables.
- One top rhythm across the four destinations, held to 1px by `e2e/rhythm.spec.ts`; drawn selects and pick lists shared by Schedule and Model; a sliding thumb on segmented controls; every page can scroll its last control clear of the floating button.
- Ambient cover light (D48): a soft light in the cover's colours behind the header of Today and of an episode, drawn by a small WebGL canvas on a GPU and by a CSS layer everywhere else.
- Schedule in Settings (D45): hour, cadence and topics of the scheduled briefing. The Create audience "Customized" is called "Somesh mode".
- Create is the primary action: a side button on wide screens, a floating button on phones, a panel for the form (full screen on a phone, a side panel on desktop) and a compact progress indicator.
- General episodes built from 24 general-news feeds, ranked by coverage, with their own topics (D43).
- One Jev request per item and a per-run Firecrawl ceiling of 30 (D42).
- The site's GitHub token reaches the repository since 2026-10-08; before that Create, Generate and config saves all failed.
- The passphrase step is switched off (D41). Caps, cooldowns and the narration budget stay enforced.
- Five topics with Top picks always included, General and Customized audiences (D39); Design and Trending ship with the app, Trending ranked by coverage, discovery only suggests (D40); a 44-entry source catalogue feeds the add-topic flow.

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
- Not done from the polish list: a press, hover and focus audit of every pressable. The Settings switch looks grey until the page's script is ready.
- A 15 minute episode still falls short: 71% for a general readout with 30 stories, and 45% for the owner's topics on a day with 12 stories, where there is not enough material. The app does not yet say how much a window holds.
- The schedule needs two owner steps before the hour can change: "Variables: Read and write" on the site's GitHub token, and a manual merge of the workflow change (24 hourly entries and the `RUN_CRON` check). Until then the briefing stays at 07:13; cadence and topics already apply. The real variable call and a real scheduled run are unverified.
- Prewarming the first audio segments on page open is written but not merged: it made the site suite fail, because the background request reaches the test server.
- Left from the QA sweep of 2026-10-08: a Play tap before the page's scripts load is lost on a phone; a refused narration (429) shows no wait time; focus on opening the player is unchecked. The failed-run styling and the phone run bar were changed but not looked at.
- Not yet run against live services: the Design and Trending topics in a real briefing (the Trending clustering threshold is untuned on real headlines), a config batch through `config.yml` (adding a topic with ticked sources), Exa source discovery, the second voice, first-time narration of a new briefing.
- GitHub fired the scheduled run 6.5 hours late on 2026-10-07 and had not fired it by midday on 2026-10-08. The gate compares dates, so a late run still lands on its day, but the time is not dependable.
- No end-to-end test applies a real op array through `config apply`, and none runs a full pipeline with Trending feeds.
- `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`.
- The player suite's three Chromium site projects, run on 2026-10-09 against the fixture build: 115 pass and 6 fail, on `main` before and after that night's merges (`gestures.spec.ts:228` and `stuck.spec.ts:95` on both phone projects, `gestures.spec.ts:67` and `stuck.spec.ts:95` on desktop). Not investigated. On 2026-10-08 every Chromium project passed (399 tests in 42 minutes with the WebKit projects). Six tests fail in WebKit on the unchanged code as well, so they are not regressions: a flick up and a long pull up on the bar do not open the page, three "stuck" paths (after Back, after the toast's Open action, and when the lazy half cannot load), and the cover flight check. In WebKit a mouse stands in for the finger, so this may be the stand-in and not Safari; only a real iPhone settles it.
- `src/player/dev/LabGlyph.astro` is unused. Delete it when convenient.
- Not tested on a real iPhone.
- Audio stored for the briefings of 6 and 7 October says "Dispatch". It lives in each briefing's front matter, so Play uses it and does not re-make it.
- First-load JavaScript budget is 103 KB and the heaviest page is at 102.9. Anything new has to load on idle or take something out.

## Known risks

- With the passphrase off, anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps (D41).
- Budget counters can read below real spend in narrow cases: an edit that does not lengthen a briefing, two briefings charged in the same instant, a function killed mid-synthesis. The engine workflow and the site function keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- `podcast.yml` and `config.yml` push to main beside `run.yml`; the push rebases and retries, which has not been exercised.
- Every session builds into `apps/web/dist`; two sessions running browser suites at once give false failures.

## Next

1. Owner: `npm run secrets:push` for the Model page; decide whether sound may create its audio context before the first press.
2. Owner asked for, not started: the script in the open player with the spoken word highlighted, beside the cover, and the episode page showing insights and links in place of the script.
3. The wait before the first sound: merge the prewarm once its tests are sorted, measure on production, and stream only if it is still slow.
4. Owner: revoke the Vercel token pasted in chat on 2026-10-07; delete the empty Blob store `store_JmrDq8MB5Kwn3ejW`.
5. One generated briefing to see Design and Trending, then tune the Trending threshold.
6. Two iPhone passes, with the six WebKit failures as the checklist.
7. Curation quality, in order: group patch releases per repository, record only published ids in `markSeen`, calibrate the 0.4 threshold on the golden set, feed per-source pass rates into the score.
