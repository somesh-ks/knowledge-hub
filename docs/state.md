# State

Last updated 2026-10-08, end of day. Rewrite this file; do not append.

The reader is called Singularity (D30). Identifiers keep `dispatch`. Everything below is on `main` and deployed at news.someshks.work unless a line says otherwise.

## Working in production

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius), validate, commit as the owner.
- Vercel deploys the site from the Git integration. CI on Linux: typecheck, lint, tests, site build, gitleaks. Auto-merge for owner and Dependabot PRs. CI does not run the browser suites or `astro check`; both are run by hand before a PR.
- Reader in the visual language of Google Podcasts (D31): Today, Library, Create Podcast, Settings. The light page surface is a cool off-white (`grey.50`); sheets, menus and the player bar are white.
- Today and episode pages: one three-dots menu at the far right of the title (Share, Regenerate, and Delete on an episode), the story count or date beside the play chip, "Contents" centred beside the page, "Other episodes" below. An episode page shows Highlights (headline, what was said, link per story), not the script.
- Library: filters All, Daily, Weekly, Custom; search that also matches episode scripts and story text through an index fetched on first use; Gallery and List views; a play button on a cover under a mouse or keyboard focus.
- Player (D32): one surface from the bottom bar to a full page, with seek, a clock and volume on wide screens. The whole bar opens it, with no colour change under the pointer. The open player has one quiet row for speed (one button that steps through the speeds) and the story's source; on a wide screen with a mouse the page keeps the scrubber and the two skips and leaves previous, play and next to the bar.
- Narration on Play, story by story (D33). The first segments are made when a page opens, so Play starts sooner. The first Play on a page with no audio starts by itself. Space plays and pauses from anywhere once the bar is there.
- Interface sounds by kind of action (navigate, select, open and close, transport, success, failure) through one delegated listener, loaded on the first gesture, following the Sounds setting.
- Making something shows live stages in the run indicator: seven for a briefing (one per workflow step, then "Updating the site"), three for an episode ("Getting ready", "Making the episode", "Updating the site"). Toasts share one quiet style.
- Custom episodes (D37), twelve a day and two minutes apart. Discussion episodes use a second voice by default (`dominic_32`). The writer is told the length in words; 5 and 10 minute episodes land at 83 to 90% of the length asked for. `dispatch podcast --dry-run` measures a request without writing.
- Delete an episode, or regenerate it with feedback (D44). A delete takes effect at once on the device that asked.
- Settings: Daily podcast (Schedule, Topics, Sources, each with its current value), Playback, Appearance, About. Schedule (D45) sets the hour, cadence and topics of the scheduled briefing. Generate is no longer in Settings; "Regenerate" on Today opens it.
- General episodes built from 24 general-news feeds (D43). One Jev request per item and a per-run Firecrawl ceiling of 30 (D42). Five topics with Top picks always included; the Create audiences are General and "Somesh mode" (D39, D40).
- The passphrase step is switched off (D41). Caps, cooldowns and the narration budget stay enforced.
- Design tokens: about 500 (colour, type, spacing, radius, motion). Style tests forbid raw colours, raw durations, raw lengths for spacing, type size and radius, and reading a custom property nothing defines.
- A tab left open across a deploy reloads itself once when a script import fails. The service worker follows script imports six levels deep when it saves the shell (cache version v3). The pointer passes through page transitions, so the cursor no longer flickers over the navigation.

## Development

- `npm run dev` shows the Agentation toolbar for leaving notes on elements. It is behind `import.meta.env.DEV`, and `checkBundle` fails any build that contains it. Stop the dev server when done (`npx astro dev stop` in `apps/web`): one left running across an install serves broken islands.
- Worktrees under `.claude/worktrees/` link `node_modules` by junction. Remove one only by unlinking every junction first; `docs/learnings.md` has the incident.

## Tooling (D38)

- Ten subagents are defined (eight user level, `dispatch-verify` and `dispatch-worker` in `.claude/agents/`), plus the `/close-session` skill and a read-only Bash hook. At most four run at once.
- `dispatch-worker` stops at 60 turns, often mid-task and without a report; resume it with "commit first, verify, report". Its worktree cannot start the player lab's dev server, so workers can run only the `site-*` player projects.
- Untested: the per-call `effort` override, the `omitClaudeMd` saving, `researcher`'s Firecrawl tool names and post cap, `ui-critic`.

## Written, not merged

- `feat/player-bar-and-script` (also in `ship/final`): the bar in YouTube Music's layout carrying the one timeline with a tick per story; the open page reduced to cover, one-line title, source link, two 10 second skips and a speed menu; no flying cover; play without an accent fill; for an episode, the script in the open player with two named hosts, Ada and Leo, and the turn being spoken highlighted. Screenshots look right. It is NOT merged: on the combined branch the player suite fails 10 tests on the Chromium site projects (`stuck.spec.ts` 71, 95, 113, 195: a tap on the bar does not open the player again after a navigation, and the fallback when the lazy half cannot load; `gestures.spec.ts` 67 and 228: flick down to close, and Tab reaching behind the open page; `layout.spec.ts` 103 at 1280x620 and 1280x800), and `e2e/persistence.spec.ts:57` fails in the site suite. Its worker ran only part of the suite. Whether these are stale tests or real faults is not yet known.

## Not working or unverified

- Two player tests fail on `main` on the `site-desktop` project, so one of the pull requests merged on 2026-10-08 (#25 to #33) broke them; which one is not known: `gestures.spec.ts:67` (a flick down on the open player's header with a mouse does not close it) and `stuck.spec.ts:95` (with the player open, the toast's Open action cannot be pressed). Both passed that morning. The chevron and Escape still close the player. Bisect these first.
- `ship/progress-sounds` (live run stages, quiet toasts, interface sounds, the cursor fix, budget 104 KB) is committed locally and checked (552 site tests, 3,939 unit tests) but was not pushed: the owner stopped the push on 2026-10-09.

- Not verified by the owner on the live site: everything shipped on 2026-10-08 after the first-Play fix. Interface sounds and the live stages were checked only in the fixture build's browser tests.
- The cause of "no player bar, narration is not available" on 2026-10-08 was not reproduced. Production played correctly in a fresh browser; the stale-tab recovery addresses the likely cause.
- Word-level highlighting in the script is not built, and the script view itself is in the unmerged player branch. Word level needs Speechify's word marks stored beside each segment's audio and returned by the lookup.
- Episode stages are coarse because `podcast.yml` makes the whole episode in one step. Finer stages need the engine's podcast command split into phases and a workflow change (a manual merge).
- The schedule's hour: the workflow change is merged; the site's GitHub token still needs "Variables: Read and write" before the hour can change from Settings. Until then it stays at 07:13. The real variable call and a real scheduled run are unverified.
- Not yet run through the real workflow: deleting an episode and regenerating one.
- A 15 minute episode still falls short: 71% for a general readout with 30 stories, 45% for the owner's topics on a day with 12 stories. The app does not say how much a window holds.
- First-load JavaScript budget is 104 KB, raised twice on 2026-10-08 (from 102). Reading pages are at 101.5 to 102.4 KB; Topics and Sources are at 103.5. Loading those two pages' editor on first use would bring it back down.
- The player's dev lab page is served in production (`/dev/player-lab`). It should be left out of production builds.
- The player suite: every Chromium project passed on 2026-10-08 on the player that is on `main`. Six tests fail in WebKit on that code; in WebKit a mouse stands in for the finger, so only a real iPhone settles it. Not tested on a real iPhone.
- Left from the QA sweep: a Play tap before the page's scripts load is lost on a phone; a refused narration (429) shows no wait time.
- Not yet run against live services: the Design and Trending topics in a real briefing, a config batch through `config.yml`, Exa source discovery, the second voice heard.
- GitHub fires scheduled runs hours late on some days. The gate compares dates, so a late run still lands on its day.
- `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`. `src/player/dev/LabGlyph.astro` is unused.
- Audio stored for the briefings of 6 and 7 October says "Dispatch".
- About 13 MB of the repository is old design history that nothing loads (`docs/prototype`, `docs/design/screenshots`, `apps/web/docs-screenshots`); the owner has not said whether to remove it.

## Known risks

- With the passphrase off, anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps (D41). The prewarm adds a few hundred narrated characters per page opened that has no audio yet.
- Budget counters can read below real spend in narrow cases; the engine workflow and the site function keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- Every session builds into `apps/web/dist`; two sessions running browser suites at once give false failures. Four workers building at once make the machine slow enough for timing tests to fail.

## Next

1. Fix or explain the 10 failing player tests on `feat/player-bar-and-script`, then merge it. Start by running `stuck.spec.ts` alone on `site-desktop` and reading the first failure.
2. Owner: look at the live site and send notes; add "Variables: Read and write" to the site token; revoke the Vercel token pasted in chat on 2026-10-07; decide on the 13 MB of old design files.
3. Word-level highlighting in the script (store and return word marks).
4. Finer stages for episodes (podcast command in phases, workflow change).
5. Bring first-load JavaScript back under 103 KB by loading the Topics and Sources editor on first use; leave the dev lab out of production builds.
6. Name the hosts Ada and Leo in the writer's prompt, so the audio matches the page.
7. Measure the wait before the first sound on production; stream only if it is still slow.
8. One generated briefing to see Design and Trending, then tune the Trending threshold. Two iPhone passes.
9. Curation quality: group patch releases per repository, record only published ids in `markSeen`, calibrate the 0.4 threshold, feed per-source pass rates into the score.
