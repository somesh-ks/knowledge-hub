# Learnings

One line each: symptom, cause, fix. Search before debugging; older gotchas are in git history (`git log -S '<words>' -- docs/learnings.md`). Grouped by area, newest first within each. Delete a gotcha once code, a check or AGENTS.md enforces it.

## Browser tests

- Two browser suites at once share `apps/web/dist` and give false failures.
- 2026-10-22: in the cloud container Chromium goes through the agent proxy, so `--host-resolver-rules` (a build served under the production host, to see a host-gated script) did nothing until launched with `--no-proxy-server`.
- 2026-10-21: `context.route` misses the worker's requests: fake a deploy in `staticServer.mjs`.
- 2026-10-19: a source added in script was a tinted stub (no address, rating or checkbox) whose `box-shadow` spread 8px over the next row; the specs checked text, never the row's parts. A row made in script mirrors its Astro component's markup and its spec asserts the parts; a `box-shadow` or outline state spreads past the box.
- 2026-10-23: PR 227's card tokens let `.card-group`'s row padding beat the Costs card's (chips 8px under a 32px corner on a phone; `/analytics` is not in the grid spec). Screenshot every page using a primitive whose tokens change.
- 2026-10-23: a one-line story row passed its hold-still test while every publisher kept 10px at 320 and 50px at 360. Measure what a layout's flexible part keeps at 320 and 360 first.
- 2026-10-23: reduced motion in the tokens alone (enter and exit kept, distance and scale collapsed) missed every raw travel on those durations: chip labels slid, the nav pill scaled, the floating button glided. Sweep the CSS with the tokens; check with `document.getAnimations()` under emulated reduced motion.
- 2026-10-08: `getByRole("button", { name: "All" })` matched "Gallery view". Use `exact: true` for short names.
- 2026-10-12: a mocked route answers while the browser context is offline. A test of an offline save takes its mock offline with it (`route.abort`), and waits for the lazy chunk it needs before going offline.
- 2026-10-12: `waitForLoadState("networkidle")` returns at once when the page has been idle before, so a test went offline while a lazy chunk was still on its way (one run in four). Wait for the response itself, then `finished()`.
- 2026-10-17: easing the open player's Play disc press scale (a `transform` transition) made a press on it in the error state reset the page's scroll to the top in about one run in five (noticeInView.spec); no script wrote the scroll and nothing took focus. The disc keeps an instant press scale. Bisect a flaky browser test with `--repeat-each 10` per variant, not single runs.
- 2026-10-14: headless Chromium has no mobile address bar, so the bottom-stack drift cannot be reproduced in the browser suites or in screenshots. Reason from the anchors, and ask for a recording on a phone.
- 2026-10-13: the voice-picker specs failed only beside others: a scroll after the press closed the open list, as the trace's last frame showed; `openPicker` (`e2e/picker.ts`) presses until it stays open. When a spec fails only in company, read its trace's last frame before touching the product.
- 2026-10-12: an axe scan after `emulateMedia` read colours mid-fade. Wait for the page's `CSSTransition`s to finish first, and cap that wait, because an infinite or paused animation never finishes.
- 2026-10-12: Playwright can want a newer Chromium than is cached (1243 cached, 1248 wanted): an untracked `playwright.override.config.ts` beside each config sets `launchOptions.executablePath` to the cached headless shell; one PORT per worktree. Never commit a topics snapshot. A long-running `astro dev` answered 504 until restarted with `--force`.
- 2026-10-12: a server or build left from an earlier step makes a suite test the wrong build: Playwright reuses a listening server and skips the build (use `taskkill`; Git Bash `kill $!` leaves a Windows `node`), a stale static server serves old stubs, another session's `dist` serves the real briefing. Stop old servers, one worktree per session, a fresh PORT after a page edit.
- 2026-10-11: Playwright `addStyleTag` and injected audit scripts (axe) are blocked by the fixture site's CSP (no 'unsafe-inline'); use `bypassCSP: true` on the context for a probe or audit. An audit builds into its own directory and port: a `dist` rebuilt mid-audit read as "page has no title".
- 2026-10-10: a player fix for track contrast read right in the diff and failed in the browser (played and unplayed 1.46:1 apart); the worker had marked it unverified. Send a read-only verifier to measure every fix a worker marks unverified before calling an area done.
- 2026-10-10: with a lone threshold of 1, Chromium's IntersectionObserver reports a target partly past the root edge as not intersecting, and never calls back when it then leaves. To tell a sticky element is stuck, observe with thresholds `[0, 1]` and compare `boundingClientRect.top` with `rootBounds.top`.
- 2026-10-09: A WebGL canvas made the player suite fail on every page: headless Chromium draws on the processor (SwiftShader) and logs "GPU stall due to ReadPixels" each frame, and that suite fails on any warning. `failIfMajorPerformanceCaveat` does not refuse that context. Read the renderer's name from a scratch canvas (`WEBGL_debug_renderer_info`) and skip WebGL on a software one.
- 2026-10-09: The site suite cannot run with `--headed` on this machine: Kaspersky injects requests that the page's CSP blocks, and the fixture fails on any console error. Check GPU-only behaviour with a standalone script that ignores those lines and nothing else.
- 2026-10-09: A test run piped through `grep` or `tail` reports the filter's exit code, which is 0. Record `$?` of the runner itself.
- 2026-10-09: The player suite can run its `site-*` projects in a worktree without a dev server: serve the fixture build, and set `PLAYER_LAB_URL` and `PLAYER_SITE_URL` to it.

## Unit tests

- 2026-10-24: on Node 24 (V8 13.6), a function whose hot loop gets Maglev OSR code before the object literal it returns has run can return objects sharing their number fields (the sound volume test; nodejs/node#66457; not on Node 22 or with `--no-maglev-osr`). Keep hot loops out of functions that return object literals.
- 2026-10-14: Vitest, like Chromium, remembers a failed dynamic import for the module's URL, so a retry test of a lazy import passes or fails depending on test order. Retry with a `?retry=` query (pageContentLoader) and test the retry in the browser, not in Vitest.
- 2026-10-11: the pipeline tests' fake RSS fetcher returns every item whatever the window, so a test about posts outside the window (the scoring sample's backfill) passed for the wrong reason until the test wrapped the fetcher to honour `window.from`. Check a fake honours what the test is about.
- 2026-10-08: a limit nobody asked for is a bug waiting for its first user: two episodes a day stopped the owner on the first day. Tests that hard-code a policy number (a cooldown of 30 minutes) break when the policy moves; compute from the constant.
- 2026-10-08: a test that misfiles a story into a retired section no longer fails validation, because published briefings must still validate; use a live section instead.

## Engine and workflows

- 2026-10-27: a briefing shipped 3 stories (79 s): grounding dropped 5 of 8 and the refill found the reserve empty, because the structure's section caps capped the reserve too (#373 lifts them for the reserve and warns `under_length`).
- 2026-10-27: the runner has no ffmpeg with libopus, so Opus and its test skipped in silence; ffprobe counts MP3 padding (52 ms a turn). The workflows install it, turns are measured by decoding (#381). The install then hung 5 to 19 min, `-qq` hiding the stage, and a timeout would fail an episode: bound apt, skip man-db, log, `continue-on-error` where an MP3 exists (#388).
- 2026-10-25: the config store silently undid a PR's config edit (D185).
- 2026-10-25: `urlKey` (sources/import.ts) dropped the query string, so every YouTube feed (`?channel_id=`) matched every other: a second channel failed "Already a source", and the store's replay of an added channel could not read it. A feed's key keeps `channel_id`.
- 2026-10-25: a Speechify request without `language` is detected per segment; a foreign name came back in another prosody, heard as a pitch shift. Pin `language` and hash it.
- 2026-10-23: Vercel's Neon integration names its variables `NEON_*`, which nothing reads; seed before the GitHub variable goes on. lightningcss rejects `::picker(select)::backdrop`: scrim with a `0 0 0 100vmax` shadow. A long-press drag that keeps the list scrolling cannot be pointer events (`touch-action: none` kills scroll): use `draggable`, cancel `dragstart` on a sideways swipe.
- 2026-10-24: a 5-minute daily aired 3.0: 14 written, validation cut 7, nothing refilled. Validation refills once from `reserve.json`. Grounding never saw the title the writer read.
- 2026-10-22: three review rounds of new `health` checks each found false faults (a waking Neon, an edit during a run, Dependabot merges Hobby never deploys, a regenerate read as late). A fault must be actionable and hold a day; make the rest warnings.
- 2026-10-20: a group page saved its mix on a fallback home while the engine read the fixed one, and the outlet cap keyed by `source_id` let BBC's five feeds through; one helper (`groupHomeId`) and the story's host fix both. Review found both, no test did.
- 2026-10-19: adding a YouTube channel said "The address could not be read": the preview caps a page at 1 MB, a channel page is 1.3 MB, and `resolveYoutubeChannel` swallowed the throw. The id comes from the path, then `navigation/resolve_url`, then the page. A social page with no feed (x, instagram, tiktok) is refused as a scrape source.
- 2026-10-24: YouTube refuses datacenter addresses: the player API says 429 and yt-dlp hits "Sign in to confirm you're not a bot"; cookies lift it, PO tokens do not (yt-dlp #15865). Firecrawl's `youtube-com/videos/video_transcript` makes the call from its network, 5 credits.
- 2026-10-24: no YouTube video had ever reached the judge (25 fetched since 9 Oct, `asked` 0 in `state/source-stats.json`): the prefilter keeps only keyword, author, high-signal or tagged items, and video titles name no keyword. The channels are seeded high-signal now. Check `asked` before debugging a later stage.
- 2026-10-19: a YouTube finalist reached the writer with only its description: `extractFullText` fetched a watch page with no speech. YouTube items go through `extract/youtubeText.ts`: subtitles, then Gemini (`GEMINI_TRANSCRIBE_MODEL`, first 30 minutes, 3 a run), cached in `state/video-text.json`; failure degrades to the description.
- 2026-10-19: the caption track URLs on a watch page answer 200 with an empty body, so every video fell through to Gemini. The player API's Android client (`youtubei/v1/player`, no key) lists tracks whose URLs return the text. A fake that returns captions proves the parser, not that YouTube still serves them: probe one live video after any change here.
- 2026-10-07: `audio.yml` failed at the write guard ("changes outside the publish allowlist: .gitignore"): `vercel link` and `vercel env pull` edit `.gitignore` and write `.vercel`; run them in a scratch directory outside the checkout.
- 2026-10-08: Vercel Hobby includes 2,000 advanced Blob operations a month (`put`, `copy`, `list`) and 10,000 simple ones (`head`, a read that misses the cache); going over locks the store for 30 days. Count operations per call when designing anything that writes to Blob, and never `list` on a page view.
- 2026-10-18: the 15-minute weekly aired 14 stories: the prefilter's fixed cap of 80 filled 27 of 52 slots, grounding and validation dropped 11. `poolCapFor` now sizes the prefilter, writes 85% spares up to 80 and cuts to the narration limit after grounding. Read a short episode's funnel from the stage lines (`kept`, `qualifying`, `selected`, `grounding_dropped`) first.
- 2026-10-15: Claude Sonnet 5.5 answers 400 "temperature is deprecated" to any request with `temperature`, and the writer chain falls through silently to Nebius, so from 2026-10-14 the briefings were written by the Nebius model while Settings said Sonnet. The Anthropic client sends no temperature; a pick that fails over should be visible, not only in logs.
- 2026-10-15: a source with 0 fetched items and OK health is not always broken: One Useful Thing and AUX First post monthly (newest items 2026-10-01 and 2026-09-21). Read the feed's newest date before calling a source dead.
- 2026-10-15: the eval's quality score moves ±0.25 between runs on the same episode; read the judge's reasons (`loop/inspect.ts` in the eval job log) before acting on a score change.
- 2026-10-14: Firecrawl bills a cached scrape (its Faster Scraping page: "Cached results still cost 1 credit per page"), so `maxAge` cuts latency and not spend. Only a request that is not made saves a credit.
- 2026-10-12: the workflows installed all 445 packages to run one CLI. `npm ci --ignore-scripts --workspace=packages/engine --include-workspace-root` installs 118 and takes 4.3 s, not 10.4.
- 2026-10-12: Vercel's hourly cron cannot land on a half-hour slot (India, UTC+05:30). The route accepts a call whose UTC hour overlaps the slot, so a run can start up to 30 minutes early, and the gate dedupes it.
- 2026-10-12: episode length: a writer told a length in characters delivers a third to two thirds; in words, per story and in total, 83 to 90%. A script cannot be longer than its stories carry, so hold it to that, not to the request (D43). Asking for 90% of the reachable length gave 79 to 87% and wrote almost every episode twice: ask for 95% and accept a reply within a few percent of the floor.
- 2026-10-11: a missing morning briefing was GitHub, not the gate: the 07:13 Stockholm entry ran 13:11 to 14:02 on 7 to 10 October, a platform-wide delay since 2026-08-26. Before debugging a missed run, list `run.yml`'s schedule runs ("skipped" means no runner) and read the Gate log. The trigger moved to Vercel Cron (D61).
- 2026-10-11: `singularity sources import` keeps an existing source's `enabled` and `options`, so a seed change to either reaches only new sources; write it into `config/sources.json` after the import (`--fresh` would lose discovered feeds and counters). The import also writes JSON that Biome reformats: run `biome format` on it before linting.
- 2026-10-11: a judge built with a fallback (Jev, then Nebius) shares the fallback's token budget with the writer, so work done for scores alone must use the primary judge alone: an outage would otherwise spend the briefing's budget on it.
- 2026-10-08: Create, Generate and saving topics all answered "not available right now" on production: the site's fine-grained GitHub token was valid but had no access to this repository, so GitHub answered 404 for the repo, its workflows and its runs. `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`; it should.
- 2026-10-07: Green tests did not catch the audio failure: nothing exercises the live Vercel, Speechify and Blob path. Run `singularity doctor --online` after any credential change.

## Site and service worker

- 2026-10-27: moving a shared rule behind `:has()` raised its specificity over podcast.css's override, cutting voice names at 70% of 70% (#378): wrap the condition in `:where()` (#386).
- 2026-10-27: a Playwright `**/api/config` route glob ignores query strings, so `/api/config?after=` slipped past the mock: match with a regex.
- 2026-10-24: a chart panel hidden by CSS (`display: none`, the Costs table view) still gets its ResizeObserver callback, at zero height, and drew a rect of -40. Guard a draw on the box (`clientHeight === 0`), not on `hidden`.

- 2026-10-24: an audit asked for `s-maxage` and one hourly cron: `no-cache` pages and `/api/site-icon` are already edge hits, and Hobby fails `0 * * * *`, so keep the 24 (D61).
- 2026-10-24: with the store on, a refused add said only "The server turned that change down": the function refuses edits itself now (duplicate source, missing topic, dead page) and said why only in its log. The 400 carries the engine's sentence as `reason` for the toast.
- 2026-10-22: after a deploy, saved pages kept the old layout (D145); a download lost its player offline (scripts in a versioned cache).
- 2026-10-22: TBT is root `:has()` restyles (first-load-js.md).
- 2026-10-16: an installed Android web app keeps the manifest's theme_color from install and paints the system navigation bar in it (Chromium's WebAppNavigationBarThemeColor); a runtime theme-color meta never repaints it, and Chrome 128 dropped dark manifest colours. Leave theme_color out to get bars that follow the system theme.
- 2026-10-14: on mobile Chrome a fixed element held by its bottom edge moves with the address bar in the same frame; one held by both edges (`inset: 0`) resizes only after the gesture, so the bar, the navigation and the floating button drifted apart (#120). Hold every bottom-stack element by its bottom edge; size a full-height fixed box with `100dvh`.
- 2026-10-11: Safari 27 has no `overlay`, so a closing dialog or popover leaves the top layer as its exit starts and the exit plays in the page: give top-layer elements their own `position` and a z-index (the top layer ignores it), and close at once under `@supports not (overlay: auto)` where an ancestor has a transform.
- 2026-10-11: the voice sample button never worked in production: it played Speechify's own URL, which the page's `media-src` blocks, and its error handler hid the button, so it looked like a missing feature. A media URL from a third party needs the CSP checked, or a same-origin route (`/api/voice-sample`).
- 2026-10-09: a move between destinations took 400 ms though the page was ready after 70: the mark that picks the animation (`data-astro-nav`) was lost in the swap, since Astro 7 keeps only its own root attributes. Carry the mark onto `event.newDocument` in `astro:before-swap`, and check what animates with `document.getAnimations()`.
- 2026-10-09: The first press after opening the app blocks for about 200 ms when the audio device has been idle, about 75 ms when warm: `new AudioContext()` inside the press. `latencyHint` and `sampleRate` do not help; a first measurement said they did, because whichever context is created first pays. Run the control with the order reversed.

## Build and tooling

- 2026-10-25: an `<svg>` in a template string has no `data-icon`, so D187 skips it; use `iconHtml()`.
- 2026-10-22: `npm install` ignores a new `overrides` entry while the lockfile holds the old version (deleting the entry alone drops it): delete it and `node_modules/.package-lock.json`, then `npm install`. A linked worktree's adapter build fails (`devalue` missing); check after `npm ci`.
- 2026-10-14: `npm run lint` checks nothing in a worktree (Biome ignores `.claude/`): run `npx biome check apps packages scripts tokens` there, and Biome on every file in `git diff --name-only origin/main...HEAD` before a PR. `biome check <dir>` on touched files passed while the root lint failed on CSS blank lines; run the root lint from the main checkout before pushing.
- 2026-10-11: Biome rewrote a generic arrow function, `<T,>(x: T) => ...`, to `<T>(x: T) => ...` in an Astro frontmatter, which the Astro compiler rejects, so a lint-clean commit broke the build. Use a `function` declaration for generics in `.astro` files and build before pushing one.
- 2026-10-08: branches that each pass alone can fail together (tab order, focus ring, touch targets, bundle size). Stack them and run the whole site suite before the PR, and measure the bundle on the stack.

## Windows and shells

- 2026-10-14: from the agent's Git Bash, `powershell -Command "..."` loses `$_`, `$env:` and `$LASTEXITCODE` to bash, and an argument or variable that starts with `/` is rewritten to a Windows path. Put PowerShell with variables in a `.ps1` file and run it with `-File`; pass several paths as one string to split, since `-File` does not pass an array.
- 2026-10-14: `pkill -f serve.mjs` inside a Bash call killed that call's own shell, whose command line matched. Kill by PID from a filtered `ps`.
- 2026-10-12: heredoc and `node -e` edits lose backslashes and backticks in the agent shell, and some worktrees refuse compound commands: write scripts with the Write tool, all-or-nothing.
- 2026-10-11: the sandbox proxy refuses news hosts (403 to CONNECT), so `curl` cannot check a feed. Fetch it with Firecrawl's scrape (`rawHtml`, a week's `maxAge`), in a subagent so the bodies stay out of the session; Firecrawl allowed about ten requests a minute.
- 2026-10-09: Ports 4524 to 4623 are reserved by Windows on this machine (`listen EACCES`); `netsh interface ipv4 show excludedportrange protocol=tcp` lists them. Use 47xx.
- 2026-10-08: `npx` can stall a minute before a local binary runs: read its output, do not rerun it. A full disk was another project's temp folder: measure before deleting.

- 2026-10-25: Windows has no flag emoji; flags are SVG from `public/flags.svg`.

## Agents and worktrees

- 2026-10-27: a squash merge leaves a branch's commits off main, so `git branch --merged` and commit searches miss them: find a branch's fate through PR search.
- 2026-10-27: Windows junctions from `worktreeLinks.mjs` deleted the main checkout's `node_modules` twice: use `--remove` before `git worktree remove`.
- 2026-10-23: a design-audit agent in a worktree-isolated session took no screenshot: the guard refused every heredoc, absolute path or glob in its Bash. Brief it to write scripts with the Write tool into the scratchpad and run `node <path>`.
- 2026-10-22: two sessions took D157 at once, and D159 and D176 collided later the same way. Workers add no decision; the lead numbers them and checks `main`'s Index again right before merging.
- 2026-10-24: `gh api repos/<repo>/rules/branches/main` returns `[]`: the D175 ruleset is not enforced, so auto-merge would merge before CI, and #265 merged while its browser job ran. Merge by hand once checks pass; `gh pr checks` can list a finished job as pending (read the PR's `statusCheckRollup`).
- 2026-10-24: a layout test's invented $97.70 in a screenshot read to the owner as real spend. Use plainly fake figures, or say "fixture", in shots shown to the owner.

- 2026-10-22: a worker lifted a rule a code comment tied to two dated owner asks (the release cap, #209) and logged it as a judgment call, and its bot review posted nothing. Before changing a rule whose comment cites the owner, ask; review every PR locally when the bot is silent.
- 2026-10-22: another session's cleanup removed this worktree (no commits looks merged): commit a WIP early; remove only your own.
- 2026-10-22: one `astro dev` per install, so a second worktree's is refused; never `--force` it (that kills the other): `PORT=47xx node e2e/run.mjs --serve-only`.
- 2026-10-22: #160 merged without its review fixes: the commit carrying them was made on a detached HEAD, so `git push` said "Everything up-to-date" and another session merged the PR's older head. After a push, compare `git ls-remote origin <branch>` with `git rev-parse HEAD`.
- 2026-10-16: a worktree's `node_modules` symlink was committed (the ignore rule `node_modules/` matches directories only), and merging that branch replaced the real, ignored `apps/web/node_modules` with it: git overwrites ignored paths. The rule is now `node_modules`; after such a merge, run `npm ci`.
- 2026-10-25: `scripts/worktreeLinks.mjs` found own packages by the literal scope `@dispatch`; #272 broke it. It reads `package.json` names now. Per package, never a scope (10-26).
- 2026-10-14: squash-merged branches never pass `git branch -d`, and auto mode refuses `-D`. Match commit subjects against main's squash bodies, keep a bundle of the heads in `.git/`, and let the owner force delete.
- 2026-10-12: cherry-pick a worker's non-merge commits (`git log --no-merges --reverse <lead>..<branch>`) and run `biome check` again afterwards: a formatting difference between two branches shows only on the combined tree.
- 2026-10-21: workers hit the 90-call cap again (sources design, docs): brief one piece each and a WIP commit after the first pass. A finished agent's worktree stays locked: `remove -f -f` after the clean check.
- 2026-10-21: a worktree can start from an older base than the brief names (it lacked 29 commits): check the last commit first and reset to the target before editing.
- 2026-10-11: the review workflow's code-review plugin stops at a PR it already reviewed: a re-labelled run posts nothing, reports success, and new commits go unreviewed. Review them locally (`/code-review` on the range).
- 2026-10-06: Auto-mode classifier blocks credential creation, store deletion and merging unreviewed PRs; the owner runs those.
- 2026-10-27: in-app moves swap the head's build meta: read it once (D202).
