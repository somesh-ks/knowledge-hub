# 2026-10-14: the first-load cuts

The first session in the cloud container (Linux, 4 cores) rather than on the owner's Windows machine. It took over a written handoff: record #106 to #109, then four first-load PRs in order, then the budget. D110 to D112 record the decisions; #110 to #116 carry the work.

What was built, and what each cut gave:

- Modulepreload hints (#111). The page loaded the islands' graph one round trip at a time after idle; a link for every eager module made the bar pressable 1.1 to 1.5 s sooner on the throttled phone profile, with LCP unchanged. 0 KB. A build step adds them, and `checkBundle` fails a page without them, so a build that stops writing them (an Astro upgrade, the Vercel adapter's folder) fails loudly. Both the static and the Vercel adapter builds were checked.
- Small trims (#112): the player's eager glyphs (0.4 KB), the open scrubber's helpers out of the shared chunk (0.3 KB), the Blocked outlets editor at idle (4.7 KB on that page). The ranked cut for scrubberMath (move `detentGain`) saved nothing: the bar imports the module too, so it moved whole into another eager chunk. "Page scripts at idle, never on first input" was applied both ways: page code moved out of the first load loads at idle, and the loaders that fetched on the first press (the Topics editor, the vote sender, the episode actions, the Create sheet, the click cues) now fetch at idle too.
- The player's motion after first paint (#113): 3.5 KB off every page. The facade keeps the old interface, so no caller changed; a call made before the motion loads waits and runs in order, which a unit test shows red without.
- The budget (#115): 150 to 109 KB, 3 KB over Topics at 105.7.

Throttled timings after #111 moved inside run-to-run noise: with the hints in place the bar waits on round trips, not bytes, and 3.5 KB is about 20 ms at 1.47 Mbps. The PR bodies carry each table.

The full browser suites, not run since #101, had 7 failures on `main`. Two were real (a 36px Add source button with no larger target; a played chip that reserved "Play again" on touch and grew 11px) and five were specs that had not followed D106 and the story controls (#116). Both suites then passed in full.

Also: `AGENTS.md` says how to get a code review (#114, at the owner's request).

Left open, in `state.md`: the chip's 11px growth with a mouse, the parked no-eager-island cut, and everything a real phone, WebKit or production would show.
