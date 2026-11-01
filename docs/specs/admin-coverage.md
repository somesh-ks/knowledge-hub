# Admin coverage

`/admin/coverage` in the command center: what the design system holds and what is built outside it. Read at build from `tokens/system.json` (`npm run system`, which the gate keeps fresh), so the page has no script and no request, and a deploy shows the numbers of its own commit.

## Requirements

- Four tiles: shared parts, one-off controls, semantic tokens, all tokens.
- Parts: one row per kind (Actions, Selection, Navigation, Feedback, Containers, Fields, Layout) with the part names on its line and the count at its end.
- One-off controls: each bespoke class that no part lists, with the reason the build allows it. A bespoke class a part lists is used through that part and is left out.
- Tokens: a row per tier (primitive, semantic, component) with its count.
- Rows are Health's shape (name and line at the start, reading at the end), tokens only, no colour.

## Not built

How many files use each part, and which tokens nothing reads. Both need a scan of `apps/web/src` that moves with every UI edit,, so `system.json` leaves it out and a page that scanned would rebuild this app on every reader change. Build it when the owner wants the numbers.

## Code

`apps/admin/src/pages/coverage.astro`.
