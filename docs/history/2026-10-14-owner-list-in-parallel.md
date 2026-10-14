# 2026-10-14: the owner's list, built in parallel

The owner brought 18 ideas and fixes in one message and asked for them to be ordered, challenged and then built by parallel workers. Three rounds of questions settled the open ones: the Model field becomes a plain dropdown, sheets lose the grabber and the corners, the transcript's highlight pauses during unseen words, votes are stored and never shown, blocking is by domain, Regenerate takes topics and comments instead of weight sliders, and covers get three layouts with a theme per month. D106 to D109 record what was built; nine PRs carried it (#96 to #104).

How it ran: workers of one tier in worktrees on disjoint files, four at a time, each branch gated and reviewed by the lead before its PR. The first wave was the bar, the polish items, the transcript bug and the engine's profile and blocklist; the Model dropdown, Regenerate, the votes engine, the Blocked outlets page and the story controls followed as slots freed. The vote op's shape was written into three briefs at once so the engine, the server and the story controls could be built side by side.

What the review changed, beyond what the workers reported:

- The transcript fix was sent back once. Its first form guessed the lead-in's length from the word marks and left the estimate path, which every listener is on until marks arrive, unfixed. The second takes the exact count from the build.
- A vote counted toward its source and its domain, so three dislikes reached the full swing. The domain's preference now applies only where the source has none.
- The polish branch squared the desktop's centred dialog as well as the bottom sheet; the dialog kept its corners.
- The Regenerate sheet had an unstyled `fieldset` and two label styles; both dialogs now share one field label.
- Two branches would have failed CI lint (an unsorted import, an unformatted test), and the workflow change needed a placeholder in the contract test.

Left open, in `state.md`: the cover direction (contact sheets on an unmerged branch), the cost findings (listings bind on every run; `maxAge` does not save credits), a touch-target failure on the Topics page that predates this work or was not attributed, and what no live run has shown yet.
