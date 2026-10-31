# Experiments page

2026-10-30. The owner asked for one admin page listing every experimental feature, each with a switch that works without a deploy, plus what a shadow run would have added.

## What happened

Three PRs, in order: the engine reads switches from Neon and caches them per run (#459); the admin page has a toggle and Promote, each behind a confirm dialog with an Undo snackbar (#461); shadow rows show "+N stories this week" from a new `experiment_hits` table (#470). The owner asked that a dialog's filled button hug its label; that went in as its own design-system PR (#462), which he merged by hand.

## Worth knowing

- Writes are serialized in the page, so a fast toggle and Undo cannot cross. Un-promoting only updates an existing row.
- A failed count read still returns the switches; a failed count save logs and never costs a run. Counts are recorded only with the store on and not on a dry run.
- `main` went red mid-review because #451 landed after D253's debt-list test; #472 fixed it with test data only. The branch merged `main` for the fix rather than editing the test.
- Not verified: the admin function and the write stage against Neon. The state doc line holds the closing condition.
- A switch pressed and the page reloaded at once showed the old state, and a later reload the change. It took three fixes because there were three causes, found in this order (D270):
  1. The switch waited for the store's answer before it moved, and the store takes a second or two to take a write (cold function, Neon waking), so a reload read first. #487: the switch moves when pressed, the change is kept in the tab (`pendingFlags.ts`) and laid over what the store answers, the write is sent with `keepalive`, and a `pagehide` guard keeps the change when the browser fails the request in flight as the page goes.
  2. The reader's service worker answered `GET /admin/api/experiments` from a copy saved up to 10 minutes earlier: the path has no `/api/` prefix and no extension, so `sw.js` took it for a page and served it from its saved copy, refreshing it only after 15 s. #494 made the worker pass `/admin` through.
  3. #487 let go of a change as soon as its own write answered, so a reload whose read came from that old copy showed the old switch (first reload reset, second or third right). #499: only a read that shows the change settles it; a write's answer updates the page's picture of the store and nothing else.
- How it was found, for the next stale read. Count the page loads against the reads that reached the server: `vercel logs requests --json --since 60m` in the app's project, then group `requestPath` by `requestMethod` (needs `.vercel/project.json` and the `VERCEL_TOKEN` in the cloud environment; `vercel logs` flags `--expand` and `--no-follow` no longer exist). Five page loads in two seconds against two reads meant something was answering the rest from a copy. Then reproduce with the real parts: a small HTTP server that serves `apps/admin/dist` under `/admin`, the real `apps/web/public/sw.js`, and a store whose writes land after a set delay; register the worker, reload once so it controls the page, press a switch, wait for the write, and reload four times, reading the switch after each. Red was off, off, off, off; green is on, on, on, on. Playwright routes cannot stand in: a route is not the worker, and it fails a request still out at a reload, which hides the rejection.
- Left out on purpose: a version or ordering guard on the write (an older write from a page the owner reloaded could land after a newer one; one editor, a second dialog in between, a write that takes 1 to 3 s; add one if the page gains editors), and a cache-busting query on the read (the worker would save a copy per query and push real pages out of its 60).
- The function crashed at load on Vercel until #485: a bare `@singularity/engine` import resolves to source the bundle omits. `vercel build` in `apps/admin` under Node 24 reproduces the bundle.
