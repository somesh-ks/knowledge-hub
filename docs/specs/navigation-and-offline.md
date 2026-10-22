# Navigation and offline

Service worker, saved copies, PWA, launch screen, offline. What it does now. Reasons: D47, D97, D98, D99, D102, D123, D127, D145; history: docs/history/.

## Requirements

### Moves between pages
- Moves between Latest, Library, Create and Settings are answered from a copy the service worker saved in the last ten minutes and swapped at once (D47). Measured on production (2026-10-09, medians): the page arrives in 2 ms (was 26), is on screen in 32 ms (was 70) and fully drawn in 132 ms (was 407).
- The current destination is marked the moment it is pressed.
- The service worker uses navigation preload and checks for an update on return. Every page load, a briefing's included, goes to the network first (3 s, then the saved copy); a page that changed behind a saved copy refreshes quietly; a new `/latest.json` makes saved pages old. On load and when the app comes back to the front (at most once a minute), the page compares its `dispatch-build` with `/build.json`; when the site is newer it shows the toast "New version available" with Reload, once per build per session, and never reloads by itself (D145, D146).
- One top rhythm across the four destinations, held to 1px by `e2e/rhythm.spec.ts`. The view transition overlay lets the pointer through, so the cursor does not flicker over a link.
- Every page names the modules it loads at start in modulepreload links (a build step; `checkBundle` fails a page that loads one without a link) (D112). Modules a press needs are fetched at idle, never on the press. The player surface's motion loads after first paint behind a facade that holds early calls. The bundle budget is 130 KB (D141).

### Offline
- The worker keeps every file a page fetches (cache v10, six levels deep), so a settings page opened offline in a later session still has its editor (D97). The offline shell is pruned and includes /library.
- Offline is the one device banner. Offline and back online are one empty-state section; `data-state` shows the true scene.
- Scenario: WHEN offline and Play is pressed THEN the reason repeats and nothing loads (D98, D99).
- Offline listening is by Download in the Library (D127): the worker answers Range requests (206, 416) and the `/api/narrate` lookup from `dispatch-audio-v1`, which holds at most 10 items and survives version bumps. Audio never downloaded is not available offline.

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
