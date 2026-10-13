# 2026-10-13: the owner's feedback on every page, and why development is slow

The owner left notes on elements in the dev server at 2038x974: padding on the Contents entries, the hero's gap, a shade under card progress bars, the Library and Settings titles, more room under the search controls and at the top of every page, Episodes renamed Custom, a smaller sort chevron, Version renamed Last updated, a gap in the theme segment, a plain topics count, AI Model, topics on Daily and Weekly "for all kinds of podcasts", the Next episode line gone, a summary card for a topic with a picture and a More menu, Add source level with its title, richer source rows, a New episode panel with more air that does not shake when More options opens, and no chevron in the bar. Then: "critically look for reasons why development in this repo is very slow."

## What was measured about the slowness

- Process start in the agent's Git Bash costs 3 to 8 s (`/usr/bin/true` included). From PowerShell, `cmd` starts in 47 ms, `node` in 67 ms, `git status` in 49 ms, and Git's own `bash --noprofile --norc` runs four commands in 148 ms; `bash -l -c true` takes 27.7 s. The cause is not found (Defender is off; the shell's PATH has 88 entries with three copies of the Windows PATH; Git sits under AppData). A one-file test took 37 s through Git Bash and 1.4 s through PowerShell.
- The four checks one after another took 321 s (typecheck 59, lint 38, tests 168, build 56). Through PowerShell and in parallel (`npm run gate -- --build`) they take 79 s.
- `npm run typecheck` did not include `apps/web`, and CI ran only that. `astro check` found 22 errors in 476 files; the first run of the browser tests after this session's edits had 51 failures from one call left after a deleted function. The browser suites are not in CI (D99), so the site is the one part nothing gated.
- Two `dispatch-worker` agents (the engine change and the topic page) each used all 60 turns, after 41 and 46 minutes, and sent no report; `learnings.md` had said so on 2026-10-10. Both set their worktrees up as the agent file said, which resolves `@dispatch/*` to the main checkout.
- 211 commits since 2026-10-01 (48% feat, 15% fix; 100 on 2026-10-06). `docs/` gained 18,264 lines and lost 1,334; `state.md`, `decisions.md` and `learnings.md` are the three most touched files (35, 28 and 27 commits). The read-first set is about 309 KB, roughly 77,000 tokens (`state.md` 45 KB with lines over 3,000 characters, `decisions.md` 187 KB, `learnings.md` 52 KB and 155 entries). A lesson written in `learnings.md` was repeated within three days: nobody who needs it reads it.
- The first-load budget is 110 KB and the largest page is 109.7 KB, so any new first-load code starts with removing other code (D53).

## What changed

- The feedback, as D102 says. Two workers ran in worktrees (the engine for general topics; the topic page) and were resumed with a commit-first order after the cap; a reviewer read each diff and found two bugs the workers' checks had not (a letter on art it could not be read against; "In no briefing yet" for a source nobody had judged), both fixed.
- The gate, the site check in `typecheck`, `scripts/worktreeLinks.mjs`, a 90-turn `dispatch-worker` that commits early, a `dispatch-verify` that no longer kills port 4321.
- The shake was measured, not guessed: headless Chromium hides scrollbars by default, and with them shown the column went from 464 to 454 px when More options opened.

## Not changed, and the owner's to decide

- The Git Bash cost itself (check the security software's exclusions for the Git folder and the repository, and trim the PATH).
- The browser suites in CI, the 110 KB budget, and the docs ritual (four files updated every session). A leaner record would be `state.md` under 15 KB with `decisions.md` read by its index only; nothing here shortened them.
- Vitest's `isolate: false` (about 5 s) and its module cache were not adopted: gains within the noise of a loaded machine.
