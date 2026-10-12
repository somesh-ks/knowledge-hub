# 2026-10-11 and 12: Polish and performance pass

The owner said the boxes looked like "ai slop", asked for the player's transcript and chapters to get a top margin and a bottom fade, for the cover and the controls to sit closer, for Ada to go as a host name (a male voice made it wrong), for names that follow the chosen voice, for a second voice on the discussion, for a Settings page that is not ugly and chips that can be selected, for the "Live curated" chip and the wait for suggested sources to go, and then for every page, screen and component to be polished until it looks like a real Google app. A later message asked for a deep look at performance: podcast generation, time to play, suggested sources, and the everyday delays. Decisions: D72 to D82 and after.

## How it was done

- One design layer first (D72, D73): tonal containers, state layers, pill buttons, a type scale. Everything else was built on it, so the pages could be polished in parallel without drifting apart.
- Workers in isolated git worktrees, one area each (Library, Today and episodes, Create, the player, Settings and Topics, the shell and its empty states, suggested sources, host names, three performance sets). Their commits were cherry-picked into the session branch, each time followed by typecheck, lint, the unit suites and the specs the change touched.
- Five critic rounds (Opus, read-only, on screenshots of every screen at phone and desktop width in both themes, then driven live on the fixture build) found about 200 problems, ranked P1 to P3; each round was fixed by workers (or by the lead, for small ones) before the next, and a later round first checked that the earlier fixes held. An automated audit (axe, tap targets, overflow) ran beside them. The rounds found fewer P1s each time: round four had three (a lost second edit inside the server's gap, a page that scrolled away from a tap, a rundown counted as a story), round five five (a form pushed off a phone by a feed address, an episode's actions live offline, the Library's search matching letters inside words, an Up next that played nothing, and an open page that scrolled itself at every turn).

## What the critics found, and why it mattered

- Outlines on every control, and hover and selected fills at about 1.03:1 from the page, so a chip could not be told from a selected one. Fix: tonal containers and an accent container for the chosen or current state, pinned by a contrast test (D72).
- Type: headline and summary within a pixel of each other on a phone, three sizes between 15 and 17px, weight 500 on everything. Fix: a scale with visible steps (D73).
- Reading pages had two Play buttons on a phone, a rule above every group and a hero that changed layout with the length of the title (D77).
- A scroll fade that never ran in Chrome (the minifier folded the timeline into the animation shorthand) and a keyboard focus ring that vanished under an opacity-based hover layer: both fixed, the first with a test (learnings, 2026-10-11).
- Settings read as a form, not a list; a source's score was drawn three ways at once; a new topic opened a page a static site could not yet have (D79).
- Legacy discussions still named Ada and Leo although the voices said otherwise; new ones take names from the voices (D74).
- Round four and five, by area. Settings: a second edit made inside the server's ten second gap was lost on Back while the page said Saved, and Format on Daily was a choice the product ignored (D91); a feed address widened the Add source form past a phone; a model's name was cut to a different model's. Player: Next scrolled a phone page by 601px, so a second tap seeked backwards; the rundown counted as story 1; two Pause discs under the open page; a Try again button that drew a play triangle (D92). Reading: a tab's jump landed 56px low because the bar hid after the heading was placed; hyphenated words made headlines lopsided; offline switched off one run starter and left three; stories stepped over with Play from here were marked played (D93). Library and Create: "ai" found every card; a match line added 20 to 40px above a list title; a segmented control grew as its check came in.

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
