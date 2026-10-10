# First-load JavaScript

Measured 2026-10-10 on `main` at `a57df71` (before any reduction), static build (`DISPATCH_STATIC_ONLY=1`). Sizes are gzipped, counted the way `apps/web/scripts/checkBundle.ts` counts them: every script, modulepreload and island module a page names, plus their static imports. Dynamic `import()` is lazy and not counted. Budget then: 104 KB; heaviest page /settings/podcast at 103.9 KB. The budget is 110 KB since D53 (2026-10-10); see "Keeping it low" at the end for the current split and what could still come off.

Pages: today `/`, briefing `/d/2026-10-09`, episode `/e/ep-20261009-2004`, library, create, settings, podcast `/settings/podcast`, topics `/settings/podcast/topics`.

## Where the bytes are

- 101.2 KB is shared by every page. 68.3 KB of it is React: `react-dom-client.production` (63.5 KB chunk with the scheduler), `react` 3.2, `react-dom` 1.4, the JSX runtime (inside `Icon`). Both islands (`PlayerRoot`, `SheetsRoot`) are `client:idle`, so React downloads on idle on every page, never before first paint.
- Own shared code is about 27 KB: `playerRuntime` 12.2 (store 22%, sheet controller 15%, reader sync 10%, plus spring, gesture math, modal scope, surface view, media session), Astro's router 4.3 + 0.8 + prefetch 1.2, `PlayerRoot` 3.9 (bar 35%, surface 30%), the layout script 2.4, `SheetsRoot` and the toaster 1.7, eager icons 1.6.
- Base UI is not in the first load. It is all in the lazy `SheetFrame` chunk (33.2 KB: Drawer, swipe dismiss, focus manager, Field), shared by the Generate, Settings and Narrate sheets.
- Page scripts add 0.1 to 2.7 KB; the podcast page's editor (2.7) is what makes it the heaviest.
- No duplicate copies of zod or yaml reach the client: neither appears in any client chunk.

## Runtime cost on a phone

Playwright, Chromium, Pixel 7 profile, 4x CPU slowdown, DevTools "Fast 3G" (562.5 ms latency, 1.47 Mbps down, 675 kbps up), a fresh context per run with the service worker blocked (a first visit), files served gzipped through a proxy in front of the test server (the test server itself does not compress; Vercel does). Median of 5 runs. "Bar hydrated" is the moment the player island loses its `ssr` attribute, which is when the bar answers a press. "JS transferred" is every script that arrived before the measurement ended (1.5 s after the bar), so it includes what the islands load on idle.

| Page | LCP ms | TBT ms | Bar hydrated ms | JS execution ms | JS transferred KB gz | CSS KB gz | Fonts KB | Images KB | HTML KB gz |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| today | 1636 | 51 | 4226 | 337 | 191 | 24.2 | 50.4 | 26.3 | 16.3 |
| briefing | 1656 | 51 | 4225 | 310 | 191 | 24.2 | 50.4 | 26.3 | 16.3 |
| episode | 1620 | 38 | 4188 | 289 | 196 | 25.8 | 50.4 | 57.6 | 19.1 |
| library | 1888 | 66 | 4221 | 286 | 191 | 22.8 | 50.4 | 65.9 | 13.8 |
| create | 1620 | 49 | 4105 | 290 | 195 | 22.8 | 50.4 | 0.0 | 10.1 |
| settings | 1600 | 56 | 3487 | 284 | 156 | 22.8 | 50.4 | 0.0 | 10.7 |
| podcast | 1624 | 63 | 3959 | 276 | 197 | 28.2 | 50.4 | 0.0 | 12.5 |
| topics | 1736 | 203 | 5610 | 293 | 190 | 29.2 | 50.4 | 1.0 | 23.2 |

Readings:

- LCP is CSS, the font and the HTML, not JavaScript: about 1.6 s everywhere, 1.9 s on the Library (cover images). Blocking time is small (under 70 ms) except Topics (203 ms, a 23 KB page).
- The bar answers about 2.5 s after LCP. That gap is `client:idle` plus a chain of round trips at 562 ms each (the island's module, then its imports), not parse time.
- About 190 KB of script arrives in the first seconds, nearly twice the counted first load: the sheets island preloads the Generate and Settings sheets (Base UI, 33 + 10 KB) on idle, and the player preloads its page content. The Settings sheet is reachable only from the dev lab.
- Fonts: one file, Google Sans Flex variable (weight 400 to 700, Latin), 49.6 KB of the 80 KB font budget, preloaded.

## Chunk tables

"Loaded by" is the page HTML or the chunk that imports it statically; the first three importers are listed.

### Eager on every page

| Chunk | KB gz | Loaded by |
|---|---:|---|
| client | 63.4 | page HTML |
| playerRuntime | 12.2 | PlayerRoot, PlayPauseGlyph |
| client | 4.2 | ClientRouter (page script) |
| PlayerRoot | 3.9 | page HTML |
| react | 3.2 | PlayerRoot, client, SheetsRoot, … |
| BaseLayout (page script) | 2.4 | page HTML |
| SheetsRoot | 1.7 | page HTML |
| Icon | 1.6 | PlayerRoot, SheetsRoot, PlayPauseGlyph |
| react-dom | 1.4 | client |
| soundController | 1.3 | PlayerRoot, SheetsRoot, themeRuntime, … |
| themeRuntime | 1.2 | PlayerRoot, SheetsRoot, playerRuntime, … |
| prefetch | 1.1 | ClientRouter (page script), page |
| ClientRouter (page script) | 0.8 | page HTML |
| preload-helper | 0.8 | AmbientLight (page script), DigestView (page script), BaseLayout (page script), … |
| PlayPauseGlyph | 0.7 | PlayerRoot |
| installHint | 0.5 | playerRuntime, settings (page script) |
| formatTime | 0.5 | PlayerRoot, soundController, playerRuntime, … |
| toastStore | 0.3 | SheetsRoot |
| page | 0.1 | page HTML |
| runKey | 0.1 | SheetsRoot |
| client | 0.0 | client, prefetch |
| **Total** | **101.2** | |

### Eager on some pages

| Chunk | KB gz | Pages | Loaded by |
|---|---:|---|---|
| podcast (page script) | 2.7 | podcast | page HTML |
| library (page script) | 1.5 | library | page HTML |
| settings (page script) | 1.1 | settings | page HTML |
| topics (page script) | 0.8 | topics | page HTML |
| EpisodeView (page script) | 0.6 | episode | page HTML |
| AmbientLight (page script) | 0.3 | today, briefing, episode | page HTML |
| create (page script) | 0.2 | create | page HTML |
| DigestView (page script) | 0.1 | today, briefing | page HTML |

### Lazy (dynamic import; not in the budget)

| Chunk | KB gz | Reachable from | Imported by |
|---|---:|---|---|
| SheetFrame | 33.2 | all | GenerateSheet, SettingsSheet, NarrateSheet, … |
| SettingsSheet | 9.9 | all | SheetsRoot |
| narrationRuntime | 5.5 | all | playerRuntime |
| PlayerPageContent | 4.1 | all | PlayerRoot |
| src | 3.8 | all | soundController |
| generateRuntime | 3.0 | all | SheetsRoot, GenerateSheet |
| topicsEditor | 2.6 | topics | topics (page script), topicsSheet |
| ambientLight | 2.2 | today, briefing, episode | AmbientLight (page script) |
| LazyIcon | 2.1 | all | PlayerPageContent, GenerateSheet, SettingsSheet, … |
| GenerateSheet | 1.8 | all | SheetsRoot |
| topicsSheet | 1.7 | topics | topicsEditor |
| runStatus | 1.6 | all | BaseLayout (page script), createPage, episodeActions |
| createPage | 1.6 | all | createSheet, create (page script) |
| FieldControl | 1.5 | all | GenerateSheet, NarrateSheet |
| briefingPage | 1.4 | today, briefing, episode | DigestView (page script), EpisodeView (page script) |
| managePageSave | 1.4 | podcast, topics | podcast (page script), topicsEditor |
| episodeActions | 1.4 | episode | EpisodeView (page script) |
| navigationBoost | 1.3 | all | BaseLayout (page script) |
| combobox | 1.3 | podcast | podcast (page script) |
| uiClicks | 1.2 | all | BaseLayout (page script) |
| podcastProfiles | 1.1 | podcast | podcast (page script) |
| NarrateSheet | 1.0 | all | SheetsRoot |
| deletedEpisodes | 0.6 | all | BaseLayout (page script), episodeActions |
| createSheet | 0.5 | all | BaseLayout (page script) |
| navigation | 0.4 | all | PlayerPageContent, generateRuntime, coverPress, … |
| voices | 0.4 | all | createPage, podcastProfiles |
| FieldDescription | 0.3 | all | GenerateSheet, SettingsSheet |
| coverPress | 0.3 | all | playerRuntime |
| passphrasePrompt | 0.2 | all | NarrateSheet, narrationRuntime |
| access | 0.0 | all | GenerateSheet, narrationRuntime, managePageSave |

### Per page

| Page | Eager KB gz | Eager files | Page-specific eager |
|---|---:|---:|---|
| today | 101.6 | 23 | AmbientLight (page script) 0.3; DigestView (page script) 0.1 |
| briefing | 101.6 | 23 | AmbientLight (page script) 0.3; DigestView (page script) 0.1 |
| episode | 102.1 | 23 | AmbientLight (page script) 0.3; EpisodeView (page script) 0.6 |
| library | 102.7 | 22 | library (page script) 1.5 |
| create | 101.4 | 22 | create (page script) 0.2 |
| settings | 102.3 | 22 | settings (page script) 1.1 |
| podcast | 103.9 | 22 | podcast (page script) 2.7 |
| topics | 102.0 | 22 | topics (page script) 0.8 |

## How to measure again

1. `DISPATCH_STATIC_ONLY=1 npm run build -w @dispatch/web` prints every page's total.
2. The chunk tables and the phone run were made with throwaway scripts: follow `entryScripts` and `staticImports` from `src/lib/bundleBudget.ts` for eager files and `import(` for lazy ones; drive Chromium through CDP (`Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions`) and read `largest-contentful-paint`, `longtask` and `Performance.getMetrics` (`ScriptDuration`).

## Keeping it low (2026-10-10, D53)

Measured on the design pass branch, static build, source maps mapped back to files (gzip shared out in proportion to raw bytes inside each chunk). Heaviest page /library at 103.2 KB.

| Chunk | KB gz | What is in it |
|---|---:|---|
| React client | 63.4 | react-dom client and the scheduler |
| playerRuntime | 12.4 | store 2.7, reader sync 1.5, open-player controller 1.4, runtime 1.0, media session 0.7, reader math 0.7, surface view 0.6, switchable audio 0.6, timeline 0.4, modal scope 0.4, spring 0.4, the rest under 0.3 each |
| Astro router | 5.3 | client 4.2, prefetch 1.1 |
| PlayerRoot | 3.8 | bar 1.5, surface 1.1, page content loader 0.3 |
| react + react-dom | 4.6 | |
| layout script | 2.5 | navigation 0.6, device banners 0.3, app 0.3, theme colour 0.3, Create entry 0.3, service worker 0.2 |
| SheetsRoot | 1.7 | sheets root 0.8, toaster 0.4 |
| Icon | 1.5 | the eager player glyphs |
| sound, theme | 2.7 | sound controller 1.4, theme runtime 1.3 |
| Library page script | 1.5 | the Library's search, sort, filter and view |

Ways to bring it down, largest first:

1. React only when there is something to show: about 76 KB off a first visit with nothing playing (React 68, PlayerRoot 3.8, SheetsRoot 1.7, icons 1.5, glyph 0.9). The player runtime would start from its own page script (it is plain TypeScript and already answers the play chips through reader sync), and the React bar, the open player and the sheets would mount when a track is loaded or resumable, on the first press of Play or Create, or on idle after the first interaction. Cost: the first Play on a cold visit waits for the React chunk unless it is fetched on hover or touchstart; a medium refactor of how PlayerRoot and SheetsRoot mount (a custom client directive or a manual root). The largest saving there is, and the only one that is not a few hundred bytes.
2. The open-player machinery on first play: about 4 KB off every page (open-player controller 1.4, surface view 0.6, spring 0.4, modal scope 0.4, gesture math 0.2, player sheet 0.2, media session 0.7). `playerSheet` is a singleton the bar and the surface read, so it needs a facade that loads the controller when the dock first shows.
3. The service worker code after load: 0.2 KB. It already registers only after the load event.
4. Not worth it: the Library script's search on first focus (about 1 KB, Library only), the device banners (0.3 KB, would add a layout shift when a stale banner arrives late), dropping prefetch or the router (D47).

