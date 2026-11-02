# Navigation and offline

Service worker, saved copies, PWA, launch screen, offline. What it does now. Reasons: D47, D97, D98, D99, D102, D123, D127, D145; history: docs/history/.

## Requirements

### Moves between pages
- Moves between Latest, Library, Create and Settings are answered from a copy the service worker saved in the last ten minutes and swapped at once (D47). Measured on production (2026-10-09, medians): the page arrives in 2 ms (was 26), is on screen in 32 ms (was 70) and fully drawn in 132 ms (was 407).
- The current destination is marked the moment it is pressed. The pill growing under it carries on, at the same instant, on the bar of the page that arrives: the new bar takes the old pill's animation start time (`navigation.ts`), so a slow swap does not take it back. A finger has already drawn the pill (the press layer): the arrival eases it from the press tone to the current one in place and does not grow a second, smaller pill.
- A briefing or an episode keeps the tab it was opened under (the Library's card for the latest podcast leaves the Library lit, with a Back to it), for the visit and across a reload; opened from nowhere it is the page's own tab. A move that leaves the same tab lit does not grow its pill again.
- Between two tabs the pill grows in place from its centre over 300 ms on the hover curve and never travels (D280). The page arrives from the side the move came from: from the end side for a tab further along the bar, from the start side for one before it (D341).
- On a phone the whole bar is the tab: each link's hit layer (`.app-nav-item::after`) covers its cell and the strip above the home indicator, so a press is never on the bar between tabs. The pill is only drawn.
- A drill in or out does not move the cover (D336). The page arrives from the end side into a briefing or episode and from the start side on the way out, 36px, settling in 250 ms on the drawer curve; a tab move takes 150 ms. From 64rem a tab move rises 12px, from below for a lower row of the side column. A key press moves nothing. A tapped Library card keeps its press until its page has arrived (D341). A cover card holds its place on the way back (`libraryView.ts` restores the scroll).
- A move does not start the persisted player's animations again: each keeps the time it had (`persistedMotion.ts`).
- The service worker uses navigation preload and checks for an update on return. Every page load, a briefing's included, goes to the network first (3 s, then the saved copy); a page that changed behind a saved copy refreshes quietly; a new `/latest.json` makes saved pages old. On load, when the app comes back to the front and every 10 minutes in front (at most once a minute), the page compares the `singularity-build` it loaded with (read once in `app.ts`: moves inside the app swap the head meta) to `/build.json`. When the site is newer the page reloads itself as soon as no audio plays or buffers, no dialog, sheet or toast is open and no text field has focus or typing in it (what the reader typed is tracked from the start of the page, `typing.ts`, so text typed before load counts); until then it tries every 5 s, on each move inside the app and when hidden. One build is loaded for at most twice per tab. There is no prompt (D145, D202). A move inside the app whose next page names another build than the running bundle is made as a full load, online only (`buildGuard.ts`), so new markup never meets old scripts (REL-12).
- One top rhythm across the four destinations, held to 1px by `e2e/rhythm.spec.ts`. The view transition overlay lets the pointer through, so the cursor does not flicker over a link.
- A finger going down on a card or link fetches its page at once; and the Library's cards in view are fetched at low priority while idle (at most 8 per visit to the app, each once), so the edge nearest the person and the worker hold the page before the tap (`navigationBoost.ts`).
- Every page names the modules it loads at start in modulepreload links (a build step; `checkBundle` fails a page that loads one without a link) (D112). Modules a press needs are fetched at idle, never on the press. The player surface's motion loads after first paint behind a facade that holds early calls. The bundle budget is 130 KB (D141).

### Offline
- The worker keeps every file a page fetches (a versioned cache, `VERSION` in `sw.js`, six levels deep), so a settings page opened offline in a later session still has its editor (D97). The offline shell is pruned and includes /library.
- Offline and, for 2.5 s after the connection returns, back online are one Banner strip above the app bar and the side column (`#banners`, `shell.css`). It is in the layout: it squeezes the page down as it opens and the page rises as it closes, so a page opened under it lands where it stays. Offline becomes back online in the same band. After a navigation it is drawn again as it was, with no motion.
- Offline is the one device banner. Offline and back online are one empty-state section; `data-state` shows the true scene.
- Scenario: WHEN offline and Play is pressed THEN the reason repeats and nothing loads (D98, D99).
- Offline listening is by Download in the Library (D127): the worker answers Range requests (206, 416) and the `/api/narrate` lookup from `singularity-audio-v1`, which has no cap (D281) and survives version bumps. Audio never downloaded is not available offline.

### PWA
- The manifest names no colours, so an installed app's Android bars and splash follow the system theme. It has shortcuts. Settings has an Android Install row.
- The installed app opens on a 0.9 s launch screen (`LaunchScreen.astro`, `launch.css`) (D123).
- Press, vote, navigation and player micro-motion are tuned; pressing the tab of the current page scrolls it to the top.

## Code
- `apps/web/public/sw.js`
- `apps/web/src/scripts/serviceWorker.ts`
- `apps/web/src/scripts/navigation.ts`
- `apps/web/src/scripts/navigationBoost.ts`
- `apps/web/src/pages/manifest.webmanifest.ts`
- `apps/web/src/components/LaunchScreen.astro`
- `apps/web/src/pages/offline.astro`
