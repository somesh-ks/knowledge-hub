# Settings refinements and four workers

2026-10-22. The owner's Settings round, with four pieces split off to workers or a session.

## What the owner asked

- Topic chips on Daily and Weekly: unticked ones vanished into the card in dark mode, the order was not by name, and the card's bottom padding was half its top. Cards with selects looked inconsistent.
- Every Settings list: the line under a row's name moved to the row's end, with room around it. Shorter summaries: "Every other day at 7", a source count, no line for Preferences, Podcast voice, Costs, About and Change log.
- Every card and what it holds on one radius rule (concentric).
- A Software Engineering topic beside Design, AI and Technology, with the software sources moved to it.
- Better Costs charts; a User engagement item scoped well (analytics and episode sharing as a growth loop); knobs that grow while held; a full visual audit with the design-engineering plugin; Opus for hard visual work.
- Whether the version should move more slowly.

## What was built here (claude/settings-ui-refinements)

- `component.card` tokens: radius 24 = inner 16 + inset 8, held by the concentric unit test. A row's hover tile and a select's fill sit 8px in at radius 16; chips, buttons, the topic page's field, Add, chips, switch and picture sit 16px in at radius 8 (the switch's pill 4). The owner kept this over pills everywhere. A browser probe then measured every rounded box in a card corner against card radius less gap: two were off (the topic switch's tabs at 4 instead of 8, the Listen in fill a 48px pill) and were fixed; circles and capsules are exempt.
- One CSS rule puts each link row's value at its end (`.row-action > .settings-text`), so the index, Sources and Blocked sources changed without markup or script changes. Rows are 64px; index selects read in the quiet ink like the other values.
- Summaries: bare 24-hour hours, "Every other day", Sources as a source count. The topic count, the voice summary and `savedTopicCount` went with their tests.
- Chips by name; equal padding on a chip card. The dark chip tone was fixed on main the same day by #203 (`surface-overlay`); this branch kept it and dropped its own token.
- Version 0.9 shared with the Privacy page (#210), and the numbering rule in `lib/changelog.ts`: a listener-facing feature raises the minor number, fixes and polish a patch digit, and one entry a day takes the number of its largest change.

## Split off

- Software Engineering, a full uncapped section with a new judge category (`software_engineering_depth`); only version-numbered changelog headlines keep the release cap: #209.
- Costs redesign: one stacked chart, ranked breakdown, a table view, then reworked onto the Settings card grammar and tokens: #206.
- Knobs that grow while held (volume, bar scrubber), with a reduced-motion bug caught in review: #205.
- Engagement and sharing, scoped as a decision before any code: #207.
- The visual audit: 21 findings, top three reading ink for summaries, the dark `accent-container-high` step and the rail's New episode reading as the current page. Not built yet.

## What went wrong

- This session's worktree and branch were removed by a cleanup elsewhere while it had no commits; the audit agent's dev server held files in it. Nothing was lost; the work restarted on a new branch with an early WIP commit (learnings).
- Parallel sessions took the same decision numbers (D150 to D155). Check the Index on origin/main right before a PR.
