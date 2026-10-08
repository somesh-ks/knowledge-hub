# State

Last updated 2026-10-08. Rewrite this file; do not append.

The reader is now called Singularity (D30). Identifiers keep `dispatch`. Everything under "On the branch" lives on local branch `feat/singularity` and is not deployed; production still runs `main`.

## Working in production (main)

- Engine end to end on live services: fetch (Exa, Firecrawl, feeds), judge (TypeSafe Jev), write (Nebius), validate, commit as the owner.
- Vercel deploys the site from the Git integration. CI on Linux: typecheck, lint, tests, site build, gitleaks. Auto-merge for owner and Dependabot PRs.

## On the branch, tested but not deployed

- Reader in the visual language of Google Podcasts (D31): Today, Library, Create, Settings. Library is a cover grid with search, sort and filter. Settings has Topics and Sources pages.
- Player rebuilt as one surface that grows from the bottom bar to a full page (D32). On wide screens the bar is a full transport with seek, a clock and volume.
- Narration on Play, story by story (D33): `/api/narrate`, the client in `apps/web/src/narration/`, the passphrase sheet.
- Engine: four-beat voice (D34), Tech releases section and launch-scale ranking (D35), hosted narration (D29), user-defined topics with Jev topic-fit judging, source overlay and source discovery (D36), custom podcast episodes (D37).
- New cover art: eight templates, sixteen palettes, an episode variant.
- Checks on the merged branch: typecheck clean, 3,683 unit tests, lint clean, site build at 100.6 KB of the 102 KB first-load budget, site browser suite green (466 tests, including a check on every page that nothing marked hidden renders).
- Player browser suite, Chromium (the lab on a phone, the built site on a phone, a short phone and a desktop): green. Its dev lab page now renders the real reader components.

## Tooling (D38)

- Ten subagents are defined (eight user level, `dispatch-verify` and `dispatch-worker` in `.claude/agents/`), plus the `/close-session` skill and a read-only Bash hook. Settings add a 1 hour subagent cache and a cap of 4 concurrent agents at depth 1.
- Verified in a fresh session (agent files load at session start): `reviewer` is blocked on `rm` and on `>` by the hook and has no Write tool; `Explore` has only Read, Grep, Glob, Bash; `general-purpose` runs Sonnet 5.5 without the Agent tool; `dispatch-verify` passed typecheck, 3,686 tests, lint and the static build (100.6 of 102 KB).
- Untested: the per-call `effort` override, the `omitClaudeMd` saving, `researcher`'s Firecrawl tool names and post cap, `dispatch-worker`, `ui-critic`. `general-purpose` was restricted to core tools and web after one trivial call cost about 289k subagent tokens with every MCP family loaded (`Explore` and `reviewer` cost 9k and 14k); the new tool list is untested until a session restart. `scout` was retired.
- Lint exit code was not captured by `dispatch-verify`; its pass rests on Biome's summary line.

## Not working or unverified

- Nothing on the branch has run against live services: Speechify narration (per story and per turn, two voices), the Blob store address the lookup computes, Jev topic-fit questions, Exa source discovery, the writer's `spoken` tellings and podcast scripts.
- Three new workflows have never run on GitHub: `config.yml`, `podcast.yml`, and the changed `run.yml`. Workflow changes need a manual merge.
- The player suite's WebKit projects were not re-run in full after the last fixes. Four of their tests are skipped in WebKit only, because Playwright cannot send a wheel or a touch drag there; scroll containment and the cover's flight are therefore unverified in WebKit.
- `src/player/dev/LabGlyph.astro` is unused since the lab renders the real components. Delete it when convenient.
- Not tested on a real iPhone: scroll containment behind the open player, the swipe, safe areas, lock-screen controls, audio starting after the passphrase sheet.
- Audio already stored for the first two briefings says "Dispatch" and no longer matches the narration text. It is re-made on Play.
- Curation: release-note noise in the first briefings is still there (see Next).

## Known risks

- Budget counters can read below real spend in narrow cases: an edit that does not lengthen a briefing, two briefings charged in the same instant, a function killed mid-synthesis. The engine workflow and the site function keep separate counters against one Speechify allowance.
- An anonymous reader can open the passphrase sheet but cannot make audio. A briefing nobody with the passphrase has played has no audio for anyone (see the open question in D33).
- `markSeen` records every judged id, so items cut by the cap are hidden for 90 days.
- The Generate, narrate, config and podcast passphrase checks have no attempt limit beyond their cooldowns.
- `podcast.yml` and `config.yml` push to main beside `run.yml`; the push rebases and retries, which has not been exercised.

## Next

1. Owner: confirm a push. Then a preview deploy, and on it: play a briefing (first Play asks for the passphrase), add a topic, create an episode.
2. Owner: manual merge of the workflow files; revoke the Vercel token pasted in chat on 2026-10-07; delete the empty Blob store `store_JmrDq8MB5Kwn3ejW`.
3. One engine dry run to hear the new voice and see the Tech section (a few cents).
4. Two iPhone passes, then the player's browser suite on WebKit.
5. Curation quality, in order: group patch releases per repository, record only published ids in `markSeen`, calibrate the 0.4 threshold on the golden set, feed per-source pass rates into the score.
