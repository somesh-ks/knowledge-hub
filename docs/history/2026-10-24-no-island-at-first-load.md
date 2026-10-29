# No island at first load

The owner asked for every accepted idea to be built; cut 1 of [first-load-js.md](../engineering/first-load-js.md), parked since 2026-10-14, was one. [D178](../decisions/player-and-library.md#d178-no-island-loads-with-the-page-the-islands-wake-when-needed) records the decision.

## What changed

A custom Astro directive, `client:wake` (`apps/web/src/lib/wakeDirective.ts`, registered in `astro.config.mjs`), holds the player and sheets islands until `dispatch:wake`. `scripts/islandWake.ts` sends it on a start (the runtime's `hasStarted`), a press on a sheet's control (kept and replayed by `SheetsRoot` through `takeEarlySheet`), a toast, a remembered Generate run, or idle after the first pointer, key or wheel input. `startPlayerRuntime()` moved from `PlayerRoot`'s effect to the layout's script, so the Play controls answer from load without React. On wake, `islandWake.ts` also imports the renderer and both islands itself, so Vite preloads each graph at once (the islands' own imports go one level at a time); this works on the pages rendered on request (D173), which the build's HTML rewrite never sees. `entryScripts` no longer counts them, so they get no modulepreload link and `checkBundle` prints them as "more on wake". The doc's sketch of the sheets as Astro markup was not needed: the directive keeps both islands, their SSR and `transition:persist` as they were.

## Checked

- Bundle: 112.1 to 37.6 KB on Today and a briefing, heaviest 113.6 to 39.1 KB, 74.8 KB on wake.
- Lab probe before and after, interleaved: TBT about halved on Today and a briefing, Library 77 to 23 ms, LCP unchanged except the Library (1.34 to 1.05 s). A first Play with no input before it shows the bar after about 0.6 s (65 ms before); prefetching at idle saved only about 100 ms of it and was dropped.
- Both browser suites, 374 and 71, after the owner allowed the readiness waits (`hydrated`, `PlayerPage.open`) to wake the islands first. One unit test: a wake island's modules get no modulepreload and are listed on it.
