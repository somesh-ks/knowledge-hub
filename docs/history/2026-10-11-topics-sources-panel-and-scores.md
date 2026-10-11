# 2026-10-11: Topics & Sources panel, source scores out of 3, a third audit

One session, picking up after the design pass merged (#74 to #76). The owner cleared the pass's goal and sent a list of changes; a third audit ran on the merged main at the same time. Current facts are in [state.md](../state.md); the decisions are D55 and D56.

## What changed and why
- The owner's list: no Custom settings page, since the Create panel covers it; edit existing sources and open their address; a smaller breadcrumb on desktop; a visible avatar for sources without a favicon; an outline Add source; adding a topic in a side panel on desktop and a full sheet on a phone, in the same panel as adding a source, split by a segmented control; Settings' row named Topics & Sources; suggested sources as the next step of adding a topic, ticked and added at once; a score out of 3 per source from health, quality, accuracy and whatever else matters; and numbers that stop shaking while the playback slider moves.
- Readouts: the scrubber's bubble and the bar's times now sit over a hidden copy of the widest time they can show, and the bubble moves in whole device pixels, so text is never redrawn at a new fraction of a pixel. Measured: the bubble kept one width (97.41px) through a drag, and the desktop readout one sub-pixel phase where it had three. The owner pointed at a web-craft skill in their sk-design plugin; it is not available in this session, so the fix rests on how text is rasterised.
- Topics & Sources (D56): one panel with a Topic / Source control; a topic's second step offers up to six catalogue sources that suit it; a source's row opens the same panel to rename it, move it or open its address; each row has an open button; a site with no icon shows its first letter. The Custom page went, and its address leads to `/create`.
- Scores (D55): an engine worker built the 3-point score, the `flagged` counter and `source.update`. Its report showed that adding the parts let a clean source that never reached a briefing score 2.0 (Fair), so the parts are now combined as a geometric mean, trust counts only items that were asked the flag questions (and reads "not measured yet" under ten), and a move in the panel sets the source's category hint in a run, which a site-only move would not have done.
- Third audit: two auditors on the merged main (phone; tablet and desktop) found 25 issues, 22 of them distinct. The worst: the Create and Regenerate panels laid out as a row for their whole exit (P1, fixed first); Back from Regenerate left the episode and lost the typed feedback; drawn lists in landscape showed three of four options with no sign of a fourth; Undo and Dismiss in the save toast dropped keyboard focus to the page; the player bar shifted when a modal opened; worded buttons still shrank their words while pressed. The exit layout and the press scaling were fixed here, and the new panel waits for its exit before it goes (the old one vanished in a frame). The owner asked to merge without waiting for the worker fixing the other 19, so they are listed as open in state.md and follow in their own change.

## After #77
- The owner asked for the rest of the audit too: a worker fixed all 20 findings on its own branch, one commit each, with before and after numbers, and the commits went onto main's head without a conflict.
- A second list from the owner: the Add topic step's fields sat flush (they were in a step of their own, out of the form's gap); top Nebius models to pick by name (D58); editing a topic and its sources (D57); topics always in alphabetical order (D57); and Play instead of Create in the floating button on an episode or an older briefing on a phone (D59). Two workers built the Nebius list and the Play button in parallel while the topics work was done here; five of the six Nebius ids were confirmed on two independent sites.
- The owner pointed at the play chip on an unplayed episode: it held 8rem for its longest label and centred what it held, so "5 min" sat 23px from its start and 31px from its end. It now hugs its label, as every chip does.
- The owner asked to skip the browser suites for this round, so they did not run on the combined branch; state.md says what ran where.

## What went wrong
- A commit picked up a rename and two deletions staged earlier; a soft reset and four clean commits fixed it (learnings.md).
- The first score design was a sum, and it was the brief's, not the worker's; the worker's own report caught it.
- The desktop breadcrumb fix shrank only the parent word (22px beside a 34px title); a screenshot review caught it after the e2e suite had passed, because no test compared the two words.
- Opening a source to edit focused its Name field, which would raise a phone's keyboard over the score; caught in the same screenshot review.
- One axe scan flaked by reading the panel mid-fade.

## Left open
- Every real source reads New until it has ten judged items, so the thresholds are untested on real data (D55 says when to revisit them).
- A rename or a move through `config.yml` has not run live.
- The browser suites on the combined branch after #77 (skipped at the owner's request).
