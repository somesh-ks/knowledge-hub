# 2026-10-10: First-load JavaScript, the player page, word marks and polish

One cloud session, six pull requests (#63 to #68), three workers. Current facts are in [state.md](../state.md); the decision is D50.

## What changed and why
- Measured first-load JavaScript per page type and on a throttled phone ([first-load-js.md](../engineering/first-load-js.md)); the Podcast editor loads after first paint (#63, 103.9 to 101.5 KB on that page). React is 68 of the 101 KB every page shares, so the only large saving is preact/compat; a prototype passes the suites and waits for the owner.
- The owner's player asks (#64): no header, the speed slider between the skips, Chapters / Transcript, a word highlight, dot markers, a balanced phone layout, and a transcript in Speechify's style. Real word marks followed (#67, replacing #66).
- Curation (#65): one release per repository, seen means published, a source pass-rate nudge.
- An audit for generic UI found the reading pages clean and the template look in the form controls (#68): a flat selected segment, round flat switches, hairline fields, centred selects, plainer About copy, no hedging helper text, one smaller timeline dot.

## What went wrong
- The first suite run failed everything: the container's Chromium did not match Playwright's. A config override fixed it.
- Two pushes failed CI on formatting and a generated glyph registry that local, directory-scoped checks missed (see learnings).
- A worker could not install packages in its worktree and stopped; the preact prototype was done in the main session instead.

## Not verified
Live Speechify marks and Blob reads, the marks endpoint on Vercel, WebKit and a real iPhone, and the estimated word timing against real audio. Owner checks from the brief (keys, `doctor --online`, a dry run, live provider calls) need keys this container does not have.
