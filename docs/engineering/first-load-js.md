# First-load JavaScript

**After the cuts (2026-10-14, #111 to #115, D112):** every page names its eager modules in modulepreload links; the player's eager glyphs, the open scrubber's helpers and the player surface's motion left the first load; the Blocked outlets editor loads at idle. Per page, gzipped: Today, a briefing and an episode 104.9; Library 105.6; Create 102.8; Settings 105.1; Daily, Weekly and Model 103.1; Topics and a topic 105.7 (the heaviest); Blocked outlets 102.8; Offline 102.9; 404 102.5. playerRuntime is 11.4 KB (was 14.9). The budget is 109 KB. On the throttled profile below, on a quiet 4-core container, medians of 5: the bar is pressable at about 3.6 s on Today, a briefing and Topics (was 4.7 to 5.1 s), LCP about 1.7 s on each, before and after. Cuts 2 (in part), 3, 4 and 6 and the modulepreload hints are built; cut 1 is parked by the owner; the tables below are the measurement of 2026-10-14 before the cuts.

Measured 2026-10-14 on `main` at `377f4e3`, static build (`DISPATCH_STATIC_ONLY=1`). Sizes are gzipped, counted the way `apps/web/scripts/checkBundle.ts` counts them: every script, modulepreload and island module a page names, plus their static imports. Dynamic `import()` is lazy and not counted. The budget was 150 KB (D103), 110 KB (D53) and 104 KB before. The heaviest page, Blocked outlets, was at 111.0 KB.

Declined, not to be prototyped again: preact/compat (about 57 KB off every page, owner declined 2026-10-10). React stays.

## Blocking time (2026-10-22)

The lab probe (`scripts/perfProbe.ts`, D147: Pixel 7, 4x CPU, Fast 4G, cold, median of 3) on a local static build read TBT over the 300 ms budget on Today and a briefing. Attribution came from long-animation-frame entries (script URL, invoker, forced style and layout), a CDP CPU profile and a Chrome trace with invalidation tracking.

What blocks is style recalculation, not script. About 20 rules anchor `:has()` on the root (`:root:has(dialog[open])` and its six siblings, `html:has(.hero-actions)`, `html:has(.briefing>.tabs-bar)`, the toast's, the Library's): any insertion anywhere invalidates the root and each such rule is matched again over the document, so the parser's chunks, each island's hydration, each modulepreload link and each script that reads a box after a change pay a restyle of 20 to 90 ms. Measured on a copy of the build: those root rules turned into `:is()` took TBT from 710 and 715 to 317 and 402; every `:has()` turned into `:is()` took it to 292 and 311. The `dialog[open]` group alone is about 160 ms. A custom property written on the root restyles every element as well.

| Change | Today | Briefing | Library |
|---|---:|---:|---:|
| Before (`7e2dee4`) | 710 | 715 | 213 |
| `--gutter` left unset without a scrollbar (app.ts); the briefing page reads its boxes before its probe, once (briefingPage.ts) | 503 | 425 | 163 |
| Controls that arrive after the player mounted render in a deferred pass (PlayerSurface.tsx), median of 5 | 433 | 422 | 132 |
| After the review fixes (final) | FINAL_T | FINAL_B | FINAL_L |

LCP (about 0.9 s, Library 1.5 s) and CLS (0) did not move; the first load is 110.0 KB of 130. Left, and why: the 300 ms target needs the root `:has()` rules replaced, by attributes the scripts set on the root (`data-dialog-open` and the like) or by anchors below the root. They are design fixes with reasons in their comments (foundations, shell, library, player, create-sheet stylesheets), so that is the owner's call, not a perf task's. The rest is React's hydration of the two islands (about 100 ms in one task) and Astro's router reading the scroll position on `load`, which pays whatever restyle is pending.

## Per page

| Page | KB gz | Files | Page-specific eager |
|---|---:|---:|---|
| Today `/`, a briefing `/d/<id>`, an episode `/e/<id>` | 108.8 | 28 | StoryControls script 1.2, episodeActionsEntry 0.7, AmbientLight script 0.3, DigestView/EpisodeView script 0.2 |
| Library | 109.5 | 25 | library script 3.1 |
| Create | 106.7 | 25 | create script 0.2 |
| Settings index | 109.0 | 28 | settings script 1.5, installHint 0.7, pendingWriter 0.3 |
| Daily, Weekly, Model | 106.9 | 26 | podcastEntry 0.4, profile script 0.1 |
| Topics & Sources, a topic page | 109.6 | 29 | topicsPage 2.2, heroMenu 0.6, multiSelect 0.1 |
| Blocked outlets | **111.0** | 29 | blocked-outlets script 1.3, autosave 1.5, savedOverlay 1.3, blockedOutlets 0.3 |
| Offline, 404 | 106.8, 106.4 | 25, 24 | none |

Since 2026-10-10 (101.6 to 103.9 KB) every page grew 5 to 8 KB: playerRuntime 12.2 to 14.9, the layout script 2.4 to 2.7, PlayerRoot 3.9 to 4.2, soundController 1.3 to 1.6, Icon 1.6 to 1.8, and new eager files (SiteHeader script 0.6, resume 0.6, prewarmPage 0.3, StoryControls and episodeActionsEntry 1.9 on the three reading pages).

## Where the bytes are

Eager on every page (module shares from source maps, gzip shared out in proportion to raw bytes inside each chunk):

| Chunk | KB gz | Imported by | What is in it |
|---|---:|---|---|
| client (React) | 63.4 | the islands' renderer | react-dom-client 61.8, scheduler 1.1, @astrojs/react client 0.5 |
| playerRuntime | 14.9 | PlayerRoot, PlayPauseGlyph | store 2.9, reader sync 2.1, sheet controller 1.4, runtime 1.3, reader math 0.9, surface view 0.9, media session 0.65, switchable audio 0.6, timeline 0.5, modal scope 0.4, spring 0.4, gesture math 0.24, then 14 files under 0.4 |
| client (router) | 4.3 | ClientRouter script | Astro transitions router 2.6, swap functions 1.1, events 0.6 |
| PlayerRoot | 4.2 | page HTML (island) | bar 1.9, surface 1.3, page content loader 0.3, cover 0.2 |
| react | 3.2 | PlayerRoot, SheetsRoot, the router | react.production, and the shared CommonJS helper the router also imports |
| layout script | 2.7 | page HTML | app 0.85, navigation 0.73, device banners 0.4, Create entry 0.3, theme colour 0.26 |
| Icon | 1.8 | PlayerRoot, SheetsRoot, PlayPauseGlyph | eager glyph paths 1.6, JSX runtime 0.15 |
| SheetsRoot | 1.6 | page HTML (island) | sheets root 1.07, toaster 0.61 |
| soundController | 1.6 | PlayerRoot, SheetsRoot, playerRuntime | controller 0.67, scrubberMath 0.57, soundMap 0.38 |
| react-dom, prefetch, themeRuntime, PlayPauseGlyph, router script, preload-helper | 1.4, 1.1, 1.1, 0.9, 0.8, 0.8 | | |

Takeaways: React and the two islands are 73 of 108.8 KB on Today. With no island at all a page loads 16.0 KB (35.1 KB if the player runtime stays eager, because it answers the Play chips). No client chunk contains zod or yaml (checked in every source map). The page has no modulepreload links: the islands' graph (17 files) is discovered one round trip at a time after idle.

Lazy, not in the budget (fetched on use; the first three are also warmed at idle):

| Chunk | KB gz | Reachable from | Imported by |
|---|---:|---|---|
| SheetFrame (Base UI Drawer, swipe, focus) | 34.0 | all | GenerateSheet, NarrateSheet |
| PlayerPageContent | 8.5 | all | PlayerRoot (idle) |
| GenerateSheet (icons.ts is 4.5 of it) | 6.6 | all | SheetsRoot (idle) |
| narrationRuntime | 5.5 | all | playerRuntime, runStatus |
| savedView | 5.2 | settings, daily, topics | settings pages |
| soundmap audio (`src`) | 4.0 | all | soundController |
| createPage, runStatus, managePageSave, generateRuntime, topicsPanel | 3.9, 3.5, 3.1, 3.1, 3.1 | various | |
| topicsEditor, picker, podcastPage, ambientLight, briefingPage | 2.7, 2.6, 2.2, 2.2, 2.0 | various | |
| LazyIcon, episodeActions, uiClicks, navigationBoost, storyVotes | 1.9, 1.8, 1.6, 1.3, 1.2 | | |

The idle warm-up fetches about 100 KB beyond the counted first load (one quiet run transferred 209 KB of script against 108.8 counted): SheetFrame, GenerateSheet, PlayerPageContent and the icons arrive without a tap.

## Runtime cost on a phone

Playwright, Chromium, `devices["Pixel 7"]`, 4x CPU slowdown, DevTools Fast 3G (562.5 ms latency, 1.47 Mbps down, 675 kbps up) through CDP, a fresh context per run with the service worker blocked (a first visit), files gzipped by a proxy in front of `e2e/staticServer.mjs`. "Bar pressable" is the moment the PlayerRoot island loses its `ssr` attribute. TBT counts long tasks over 50 ms after FCP. Median of 5.

The machine was shared with other builds and browser suites during the runs, and the CPU slowdown stacks on that load: the same page measured 2.1 s LCP, 0.4 s TBT, 5.4 s bar and 0.44 s script in a quiet 3-run set and 4.2 s, 5.0 s, 9.7 s and 2.0 s in a loaded 5-run set. Read the columns against each other (interleaved runs), not against the 2026-10-10 table (LCP 1.6 s, TBT 51 ms, bar 4.2 s, script 337 ms on a quiet machine).

| Page / variant | LCP ms | TBT ms | Bar pressable ms | Script ms | JS KB | CSS KB | Fonts KB | Images KB | HTML KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Today, loaded | 4208 | 4976 | 9662 | 2036 | 140 | 36.3 | 50.4 | 9.1 | 22.7 |
| Today, quiet (3 runs) | 2144 | 396 | 5423 | 435 | 197 | 36.3 | 50.4 | 9.1 | 22.7 |
| Briefing | 2424 | 3016 | 6742 | 1765 | 140 | 36.3 | 50.4 | 9.1 | 22.7 |
| Briefing, island graph modulepreloaded | 2288 | 1568 | **4260** | 1458 | 130 | 36.3 | 50.4 | 9.1 | 23.0 |
| Topics | 2284 | 1133 | 5739 | 1643 | 150 | 40.8 | 50.4 | 0 | 15.9 |
| Topics, island graph modulepreloaded | 2212 | 744 | **4402** | 1467 | 131 | 40.8 | 50.4 | 0 | 16.1 |
| Today, modulepreloaded (loaded) | 4464 | 3339 | 7412 | 1243 | 135 | 36.3 | 50.4 | 3.1 | 23.0 |

Readings:

- LCP is CSS, the font and the HTML, not JavaScript; the modulepreload variant leaves it where it was.
- The bar answers 2.5 to 3 s after LCP because the island's graph is fetched in rounds of 562 ms: idle, then the island module and the React client, then their imports, then theirs. Hinting the 17 files in the head (a hand-edited copy of the built HTML, not a build) brought the bar forward by 1.3 to 2.5 s with the same bytes.
- Blocking time is dominated by the machine here; the library page (loaded) read LCP 4668, TBT 2975, bar 9251.
- Fonts: one file, Google Sans Flex variable (wght 400 to 700, Latin), 49.6 KB of the 80 KB font budget, preloaded, `font-display: swap` with a size-adjusted Arial fallback.

## Candidates, ranked by KB saved per unit of risk

Risk is 1 (isolated) to 5 (changes how the app mounts). KB are gzipped and counted by `checkBundle`. Nothing is built.

| # | Cut | KB off | Risk | KB / risk | Touches |
|---|---|---:|---:|---:|---|
| 1 | No island eager: the player runtime starts from a page script; React, the bar, the open player and the sheets mount when a track is loaded or resumable, on a press of Play or Create, or on idle after first input; SheetsRoot and the toaster become Astro markup and a small vanilla module that imports React when a sheet opens | 73 (Today 108.8 to about 35; 16 if the runtime also waits, which it cannot: it answers the Play chips) | 5 | 14.6 | player, sheets, BaseLayout, `transition:persist`; the service worker needs no change |
| 2 | Page scripts after first input: Blocked outlets autosave and savedOverlay (2.8), Library search and sort (about 2), StoryControls and episodeActionsEntry on the reading pages (1.5 to 1.9) | 2 to 3 per page | 1 | 2.5 | page scripts only; precedent: the Podcast and Topics editors |
| 3 | Split playerRuntime: sheet controller 1.4, surface view 0.9, modal scope 0.4, spring 0.4, gesture math 0.24, player sheet 0.2, cover morph 0.2 (3.8), media session 0.65 more | 3.8 to 4.4 on every page | 3 | 1.3 | player (`playerSheet` is a singleton the bar and surface read, so it needs a facade); the first press waits for a chunk unless it is warmed |
| 4 | Icon: keep only the bar's and the sheets' chrome glyphs eager (the SSR markup uses none) | 0.8 to 1.0 | 1 | 0.9 | player, sheets; `astro check` catches a missing glyph |
| 5 | SheetsRoot and the toaster as vanilla markup alone, React still loaded for the bar | 1.6 | 3 | 0.5 | sheets, BaseLayout |
| 6 | soundController: move scrubberMath's helper in (0.57 loaded for one function) | 0.3 to 0.4 | 1 | 0.4 | player sound |
| 7 | PlayerRoot hydrates on first interaction, bar server-rendered as now | 0 counted (the island still names its modules); about 0.2 to 0.4 s of script leaves the load | 4 | 0 | player; the early tap (D82) holds a Play until hydration, which would then take 3 round trips (about 1.7 s on Fast 3G) instead of none |

Separate from KB, both cheap:

- **Modulepreload the islands' static graph** (PlayerRoot, SheetsRoot, the React client and their 17 files): 0 KB, bar pressable 1.3 to 2.5 s earlier, LCP unchanged. It needs the hashed names at build time, so a build step or an Astro integration in `astro.config.mjs` (or the layout reading the manifest). `public/sw.js` already collects `/_astro/` paths from HTML and needs no change; no inline script; every page script stays a file. Risk 2. Best measured effect of anything here.
- **Stop the idle warm of GenerateSheet** (SheetFrame 34.0 plus 6.6): 0 counted, about 41 KB less in the first seconds. A first Create tap then pays two round trips unless it is warmed on `pointerdown` or hover of the Create control. Risk 2.
- The router imports the 3.2 KB react chunk through a shared CommonJS helper, so React's chunk loads even on a page with no island. A manual chunk for the helper would take it off; it matters only with cut 1. Risk 2.
- Not worth it or no gain: fonts (one preloaded Latin variable file with swap; a glyph subset was not measured and would save fonts, not JavaScript); hover prefetch fetches page HTML only (16 to 23 KB), no chunks; duplicate zod or yaml (none in any client chunk); dead exports were not scanned.

Guardrails for any cut: the service worker follows script imports six levels deep in `"`, `'` and backtick forms and keys its caches on `VERSION` (v7), so a change to its logic bumps it; a new lazy file must stay reachable by those patterns; no new inline scripts (the CSP lists three hashes and the head script stays under 512 bytes); every page script is a file (`assetsInlineLimit: 0`); D47's instant moves and INP mean a first press must not wait for a chunk the page could have warmed; code outside the sheets asks for a toast by event so the toast store does not split into its own chunk.

## How to measure again

1. `DISPATCH_STATIC_ONLY=1 npm run build -w @dispatch/web` prints every page's total.
2. Chunk map: a tsx script that imports `entryScripts` and `staticImports` from `src/lib/bundleBudget.ts`, walks static imports from each page's entries (eager), then dynamic `import(...)` in the `"`, `'` and backtick forms (lazy), and gzips each file.
3. Module shares: add `sourcemap: true` to `vite.build` in `apps/web/astro.config.mjs` for one build, decode each `.map`'s mappings into bytes per source, share the chunk's gzip size out in proportion, then revert the config.
4. Runtime: the CDP run above. Run the variants interleaved, one run of each in turn, and say whether the machine was busy: absolute numbers move 2x with load.
