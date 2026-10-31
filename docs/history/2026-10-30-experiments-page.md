# Experiments page

2026-10-30. The owner asked for one admin page listing every experimental feature, each with a switch that works without a deploy, plus what a shadow run would have added.

## What happened

Three PRs, in order: the engine reads switches from Neon and caches them per run (#459); the admin page has a toggle and Promote, each behind a confirm dialog with an Undo snackbar (#461); shadow rows show "+N stories this week" from a new `experiment_hits` table (#470). The owner asked that a dialog's filled button hug its label; that went in as its own design-system PR (#462), which he merged by hand.

## Worth knowing

- Writes are serialized in the page, so a fast toggle and Undo cannot cross. Un-promoting only updates an existing row.
- A failed count read still returns the switches; a failed count save logs and never costs a run. Counts are recorded only with the store on and not on a dry run.
- `main` went red mid-review because #451 landed after D253's debt-list test; #472 fixed it with test data only. The branch merged `main` for the fix rather than editing the test.
- Not verified: the admin function and the write stage against Neon. The state doc line holds the closing condition.
- A switch pressed and the page reloaded at once showed the old state, and the next reload the change: the store takes a second or two to take a write (cold function, Neon waking) and the reload read first. The switch now moves when pressed and the change is kept in the tab (`pendingFlags.ts`) until the store has it; the write is sent with `keepalive` so a reload does not cancel it. The same race can exist wherever a page waits on the store before it moves; the Settings pages are unaudited.
- The reload still showed the old state after #487: the reader's service worker answered `/admin/api/experiments` from a copy saved up to 10 minutes earlier (the request log shows the reads never reached the server), and #487 let go of a change as soon as its write answered, so the next read, an old copy, showed the old switch. A change is now settled only by a read that shows it. #494 made the worker pass `/admin` through; the page no longer depends on that.
- The function crashed at load on Vercel until #485: a bare `@singularity/engine` import resolves to source the bundle omits. `vercel build` in `apps/admin` under Node 24 reproduces the bundle.
