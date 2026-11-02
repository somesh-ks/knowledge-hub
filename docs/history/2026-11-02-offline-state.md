# Offline and app state

2026-11-02. Thread: "Fix offline mode and app state". Decisions D330, D331.

## What the owner saw

A page never opened (a daily or weekly podcast, a Settings page, Saved) showed a "You are offline" page with no strip, and the tabs lost their current mark. On Saved the list was empty. When the network returned the page stayed put; Try again went to Latest; the app reloaded itself on return; settings changed offline said "Couldn't reach the site. Not saved yet."; a switch printed "Off: no weekly podcast is made".

## Causes

- The worker answers any page it never saw with `/offline`, at the asked address. That page asked for no strip, and its recovery script ran once per document: the router swaps the page in without running a bundled script again, and the one reload fired on the browser's first `online` event, which can come before the network works.
- Saved and Settings were opened offline only if visited before. `caches.match` walks the caches by age, so Latest offline came from the shell's install-time copy.
- The settings sender is a lazy chunk; offline without it the change was refused outright.
- Each part decided "offline" itself (browser flag, worker, strip, stand-in page, outbox).

## What changed

- `lib/connectivity.ts`: one state, confirmed by asking the site, asked again on growing gaps (D330).
- The strip's stack persists across moves; `data-strip` is carried.
- The stand-in keeps the address and the strip and recovers in place (`scripts/standIn.ts`).
- The worker keeps pages ready (`KEEP_READY`) and prefers the newest copy; VERSION v16.
- Settings changed offline go to the outbox even without the sender, say "Saved. It will sync when you're back online.", and send on the confirmed return; a newer build waits for the reader's next move.
- Copy rewritten; `lib/copyGuard.test.ts` holds it (D331); the switch's helper line is gone.

## Why audits missed it

They checked each part online, or the strip on a page that was cached. None visited every route offline from a fresh device, none changed a setting offline with the sender chunk missing, and none sampled frames across a move. `serviceWorker.spec` now covers unopened pages, Saved, an early online event and Try again; `routes.spec` samples every frame of an offline move; `copyGuard` scans reader copy.
