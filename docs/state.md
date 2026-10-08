# State

Last updated 2026-10-08. Rewrite this file; do not append.

The reader is called Singularity (D30). Identifiers keep `dispatch`. Everything below is on `main` and deployed at news.someshks.work unless a line says otherwise.

## Working in production

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius), validate, commit as the owner.
- Vercel deploys the site from the Git integration. CI on Linux: typecheck, lint, tests, site build, gitleaks (with `.gitleaks.toml` allowing the invented values tests assert on). Auto-merge for owner and Dependabot PRs.
- Reader in the visual language of Google Podcasts (D31): Today, Library, Create, Settings. Library filters are All, Daily, Weekly, Custom; Custom holds everything made on request.
- Player as one surface from the bottom bar to a full page (D32), with seek, a clock and volume on wide screens.
- Narration on Play, story by story (D33).
- Custom episodes (D37): the first real run of `podcast.yml` succeeded on 2026-10-08 and published `ep-20261008-1155`. Discussion episodes use a second voice by default (`dominic_32`).
- The site's GitHub token reaches the repository since 2026-10-08; before that Create, Generate and config saves all failed.
- The passphrase step is switched off (D41). Caps, cooldowns and the narration budget stay enforced.
- Five topics with Top picks always included, General and Customized audiences (D39); Design and Trending ship with the app, Trending ranked by coverage, discovery only suggests (D40); a 44-entry source catalogue feeds the add-topic flow.

## In progress, not merged

- `feat/cost-pass`: one Jev request per item and a per-run Firecrawl ceiling.
- `feat/create-sheet`: Create as the primary action (side button, floating button on phones), a sheet for the form, a compact progress indicator, and General mode offering general-news topics.
- `feat/general-podcast`: General episodes built from general-news feeds, ranked by coverage.

## Tooling (D38)

- Ten subagents are defined (eight user level, `dispatch-verify` and `dispatch-worker` in `.claude/agents/`), plus the `/close-session` skill and a read-only Bash hook. Settings add a 1 hour subagent cache and a cap of 4 concurrent agents at depth 1.
- Verified in a fresh session (agent files load at session start): `reviewer` is blocked on `rm` and on `>` by the hook and has no Write tool; `Explore` has only Read, Grep, Glob, Bash; `general-purpose` runs Sonnet 5.5 without the Agent tool; `dispatch-verify` passed typecheck, 3,686 tests, lint and the static build (100.6 of 102 KB).
- Untested: the per-call `effort` override, the `omitClaudeMd` saving, `researcher`'s Firecrawl tool names and post cap, `ui-critic`. `general-purpose` was restricted to core tools and web after one trivial call cost about 289k subagent tokens with every MCP family loaded (`Explore` and `reviewer` cost 9k and 14k); the new tool list is untested until a session restart. `scout` was retired.
- Lint exit code was not captured by `dispatch-verify`; its pass rests on Biome's summary line.

## Not working or unverified

- Not yet run against live services: the Design and Trending topics in a real briefing (the Trending clustering threshold is untuned on real headlines), a config batch through `config.yml` (adding a topic with ticked sources), Exa source discovery, the second voice, first-time narration of a new briefing.
- GitHub fired the scheduled run 6.5 hours late on 2026-10-07 and had not fired it by midday on 2026-10-08. The gate compares dates, so a late run still lands on its day, but the time is not dependable.
- No end-to-end test applies a real op array through `config apply`, and none runs a full pipeline with Trending feeds.
- `doctor --online` does not check `GITHUB_DISPATCH_TOKEN`.
- The player suite's WebKit projects were not re-run in full. Four of their tests are skipped in WebKit only, because Playwright cannot send a wheel or a touch drag there.
- `src/player/dev/LabGlyph.astro` is unused. Delete it when convenient.
- Not tested on a real iPhone.
- Audio stored for the briefings of 6 and 7 October says "Dispatch". It lives in each briefing's front matter, so Play uses it and does not re-make it.
- First-load JavaScript is at 101.2 KB of the 102 KB budget.

## Known risks

- With the passphrase off, anyone who can open the site can start a briefing, an episode, narration or a config edit, inside the caps (D41).
- Budget counters can read below real spend in narrow cases: an edit that does not lengthen a briefing, two briefings charged in the same instant, a function killed mid-synthesis. The engine workflow and the site function keep separate counters against one Speechify allowance.
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- `podcast.yml` and `config.yml` push to main beside `run.yml`; the push rebases and retries, which has not been exercised.
- Every session builds into `apps/web/dist`; two sessions running browser suites at once give false failures.

## Next

1. Merge the three branches in progress, each after its checks.
2. Owner asked for, not started: choose the schedule's time and cadence and the scheduled briefing's topics in the app, with Customized renamed "Somesh mode" (needs a workflow change, so a manual merge); live TTS on Play; delete an episode and regenerate it with feedback.
3. Owner: revoke the Vercel token pasted in chat on 2026-10-07; delete the empty Blob store `store_JmrDq8MB5Kwn3ejW`.
4. One generated briefing to see Design and Trending, then tune the Trending threshold.
5. Two iPhone passes, then the player's browser suite on WebKit.
6. Curation quality, in order: group patch releases per repository, record only published ids in `markSeen`, calibrate the 0.4 threshold on the golden set, feed per-source pass rates into the score.
