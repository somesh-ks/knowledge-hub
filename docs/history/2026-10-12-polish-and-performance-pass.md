# 2026-10-11 and 12: Polish and performance pass

The owner said the boxes looked like "ai slop", asked for the player's transcript and chapters to get a top margin and a bottom fade, for the cover and the controls to sit closer, for Ada to go as a host name (a male voice made it wrong), for names that follow the chosen voice, for a second voice on the discussion, for a Settings page that is not ugly and chips that can be selected, for the "Live curated" chip and the wait for suggested sources to go, and then for every page, screen and component to be polished until it looks like a real Google app. A later message asked for a deep look at performance: podcast generation, time to play, suggested sources, and the everyday delays. Decisions: D72 to D82 and after.

## How it was done

- One design layer first (D72, D73): tonal containers, state layers, pill buttons, a type scale. Everything else was built on it, so the pages could be polished in parallel without drifting apart.
- Workers in isolated git worktrees, one area each (Library, Today and episodes, Create, the player, Settings and Topics, the shell and its empty states, suggested sources, host names, three performance sets). Their commits were cherry-picked into the session branch, each time followed by typecheck, lint, the unit suites and the specs the change touched.
- Two critic rounds (Opus, read-only, on screenshots of every screen at phone and desktop width in both themes) found about 100 problems, ranked P1 to P3; each round was fixed by workers before the next. An automated audit (axe, tap targets, overflow) ran beside them. A third round ran last on the merged result.

## What the critics found, and why it mattered

- Outlines on every control, and hover and selected fills at about 1.03:1 from the page, so a chip could not be told from a selected one. Fix: tonal containers and an accent container for the chosen or current state, pinned by a contrast test (D72).
- Type: headline and summary within a pixel of each other on a phone, three sizes between 15 and 17px, weight 500 on everything. Fix: a scale with visible steps (D73).
- Reading pages had two Play buttons on a phone, a rule above every group and a hero that changed layout with the length of the title (D77).
- A scroll fade that never ran in Chrome (the minifier folded the timeline into the animation shorthand) and a keyboard focus ring that vanished under an opacity-based hover layer: both fixed, the first with a test (learnings, 2026-10-11).
- Settings read as a form, not a list; a source's score was drawn three ways at once; a new topic opened a page a static site could not yet have (D79).
- Legacy discussions still named Ada and Leo although the voices said otherwise; new ones take names from the voices (D74).

## Performance: where the time went

The analyst measured from workflow history and the fixture build (production was unreachable from the sandbox). A custom episode took about 2.2 minutes at the median from the press to the page: runner setup 14 to 17 s, the podcast step 58 to 87 s (almost all the writer), the Vercel build 31 to 34 s, the page noticing the deploy about 6 s later. Play took 0.5 to 1 s with stored audio and 3 to 6 s without (every recent briefing, because `audio.yml` fails at `vercel link` on a dead token), and a tap in the first two seconds of a page was lost. A setting looked unsaved for about a minute.

- The writer rewrote almost every episode for nothing: it was asked for 90% of what the stories can carry, models delivered 79 to 87%, and the floor was 80% (D80).
- The workflows installed all 445 packages to run one CLI (D81).
- The page noticed a deploy within 10 s, the service worker cached `/latest.json` under every query string, a new episode was never pre-narrated, and an early Play tap was dropped (D82).
- Saved settings showed old values for a minute, and a new topic's suggestions waited for a rebuild (D79).

Not done, in rough order of value: one fetch for both briefing passes, a thin-story rewrite instead of a whole one, a long first turn split at its first sentence, the sheet and player code loaded on intent, a shallow checkout, and the Vercel install. They are listed in `state.md`, Next.

## Not verified

Nothing here ran against live services, a real phone or Safari. The timing savings are reasoned from the code or measured on the fixture build. The writer change (D80) has only run with fakes; the first real episode after it is the test.

## Owner steps

Merge the branch (no pull request is open); merge its four workflow files by hand; replace the dead `VERCEL_TOKEN`; decide whether pre-narrating a new episode should count against the three narrations a day.
