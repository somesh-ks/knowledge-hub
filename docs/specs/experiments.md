# Experiments page

`/admin/experiments`: every feature built but not yet trusted, one row each, with a switch that works without a deploy (D249). A switch changes the next run, never one under way.

## Requirements

- One row per entry in `apps/admin/src/lib/experiments.ts`. The page is drawn from the last deploy's files; the store's switches (Neon `experiment_flags`) are laid over it when the page loads and override the file's `enabled`.
- A switch and Promote each ask first (a confirm dialog) and, once saved, offer Undo (a toast). A promoted experiment stays on and its switch is disabled.
- A shadow row shows what it would have added this week ("+N stories"), from `experiment_hits`.
- The switch moves when pressed and never waits on the store (D259). The change is kept in the tab (`sessionStorage`, `pendingFlags.ts`) and laid over every read until a read of the store shows it, or 30 s pass (D270). The write's own answer does not settle it.
- The write goes with `keepalive`, one at a time and in order, so a reload does not cancel it and a fast toggle and Undo cannot cross. A refused or failed write puts the switch back with a toast, unless the page is leaving: then the change stays for the next page.
- While a change is unsettled the page asks the store again every 1.5 s, one question at a time, and only when no write of its own is under way.
- Without the store the rows show what the last deploy built, the controls stay still, and a note says so.
- Reads and writes answer live: `/admin` is never served from the reader's service worker (`sw.js`) or any cache.

## Scenarios

- WHEN a switch is pressed and the page reloaded at once THEN the new page shows the pressed state, whether the write has landed or not, and whether the read comes from the store or an old copy.
- WHEN two presses on one switch are in flight THEN the page shows the later press throughout and the store ends with it.
- WHEN a pending change is older than 30 s and no read has shown it THEN the page shows what the store holds.
- WHEN the browser fails a write because the page is going away THEN there is no toast and the change stays pending.

## Code

`apps/admin/src/pages/experiments.astro`, `apps/admin/src/scripts/experiments.ts`, `apps/admin/src/lib/pendingFlags.ts`, `apps/admin/api/experiments.ts`. Rests on D249, D259, D270. How the stale-read cause was found: [history](../history/2026-10-30-experiments-page.md).
