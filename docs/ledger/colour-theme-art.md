# Colour, theme and art

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## Colour, theme and art
- **Colour model.**
  - OKLCH throughout.
  - Accent hue locked to 245 to 270, neutral chroma at most 0.015 (tests).
  - Dark surfaces rise in lightness for elevation.
  - The light page is a cool off-white; sheets are pure white to read as raised.
- **Contrast is enforced in code.**
  - Text 4.5:1 on every surface in both modes.
  - Non-text 3:1.
  - Containers 1.08:1 and 1.2:1 from the page (`buildTokens.test.ts`).
  - Axe runs on every route in both schemes.
- **Theme.**
  - A 512-byte head script applies the stored choice before first paint (D20). Anything else a page restores, such as the Library's gallery or list view, waits one frame for the page script, because the head budget has no room (2026-10-08).
  - One store: `singularity:preferences` (`player/core/preferences.ts:9`, `themeInit.js:3`). Two keys once lived side by side, and the player cleared a stored dark theme (2026-10-05).
  - The theme change crossfades with a view transition, and `theme-color` metas follow. It first decodes the new theme's covers on screen (at most 400 ms), and the bars fade inside the page's picture, after "there is a glitch in the screen when I switch the app theme" (2026-10-16, D122).
- **Ambient light.** The ask was "clever integration of shaders but mild" (2026-10-08, D48).
  - A CSS field of the cover's colours, with a 128px WebGL canvas faded over it.
  - The colours are the ones the art is drawn in: "make sure the blur/shader in the podcast details page header matches the color of the albumart" (2026-10-14). The light had read the cover's palette id, while monthly covers (D110) are dressed from their season and older episodes are inverted. `coverColors` (`packages/cover/src/context.ts`) now gives the renderer and the light one answer, and a test checks that its colours appear in the drawn SVG.
  - Asked again: "the shader color should match the colors of the album art every time", "natural and not very elliptical", movement welcome (2026-10-16, D122). The colours are now read from the drawn image per theme (`coverSwatches`): the largest colour, then the two most eye-catching, never dark ink. Three round gaussian lights placed from the measured cover drift on a 40 s loop; the mask only fades the layer's edges.
  - 30 fps, off-screen paused; off for reduced motion, data saver and software renderers.
  - Software renderers are found by name, because `failIfMajorPerformanceCaveat` lets headless SwiftShader through: `WEBGL_debug_renderer_info` against `/swiftshader|llvmpipe|softpipe|software|basic render/i` (`ambientLight.ts:114`).
  - Light mode was "coloured but still faint", so the tint was remapped (0.6 light, 0.32 dark) rather than dropped (D77). The contrast proof loops every palette in both themes; the worst text is 4.78:1.
  - The field bleeds past the gutters by `min(space-12, gutter)` so the phone app bar never clips it, and hero chips sit on the surface colour (`ambient.css:32`).
  - Cost: 317 B gzip eager, 2 KB lazy on idle.
- **The playing cover's light** (D123): "Light animation of album art when playing". The cover, blurred, glows behind the open player's cover while it plays, fades on pause, breathes on 4.2 s; still under reduced motion.
- **Launch screen** (D123): "Flash screen design animation for pwa - dark & light". Installed app only; the ringed dot sends out two rings and lifts away in about 0.9 s.
- **Android bars** (D123): no manifest colours, so the navigation and status bars follow the system theme; a light theme_color had frozen a white bar that hid the buttons.
- **Covers.**
  - The first set (2026-10-05): eight templates (spring, dither, contour, numeral, lattice, orbit, aperture, band) over OKLCH palettes, chosen by seed. Forms come from the craft the briefing covers. One gesture per cover, one accent, flat colour. Neighbours never share a template; weekly covers sit matted inside a ground border; your own episodes are inverted (2026-10-08).
  - The social card is composed at 1200x630, never cropped from the square.
  - Monthly schemes from 2026-10 (D110).
  - Medium chroma, 0.12 or less, after "too saturated ... too much on the eye when multiple albums are viewed at the same time"; three monthly series with their own style sets, all printed on the month's paper in its inks, on three close tints (weekly palest, then on-demand, then daily) after "the albums should be in a harmony"; crisp in the light theme and faded in the dark; the year after the month; the weekly range reads "2 – 8 November" (2026-10-15, D121).
  - Current cap (D171, 2026-10-23: "very dull"): chroma 0.16, a deeper, tinted light stock, richer inks. It replaces the 0.12 cap above, which lasted eight days.
  - A step brighter in both themes after "too dull in both dark and light theme" (2026-10-16, D122): paper 0.80 to 0.92 light and 0.73 to 0.85 dark, full chroma on the dark page, and a card's progress scrim on the bottom quarter only. Then "slightly saturated as the colors are too dull": paper chroma 0.045 and spot and tint 25% richer, under the 0.12 cap.
  - Contrast held by `TYPE_CONTRAST` and `FORM_CONTRAST`; date text sits at 11 to 16:1; topic-art letters use the inverse text at 4.5:1 (`cover/src/palettes.ts:137`).
  - The Strata, Orbits and Facets redesign was rejected as busy: an outlined numeral, strokes crossing the digits, and titles unreadable at 48px (2026-10-13).
  - Reviewed on a contact sheet with a 1080-render crash sweep before wiring (2026-10-05).
- **Generated topic art** from id and name (D102).
- **Empty states.**
  - The ask was "beautiful empty state illustration with title and an action button", then "keep the illustrations simple" (D96, D98).
  - Each is one flat object of two to four shapes in theme tones, then a 22px title, one line and one filled action.
  - Inline SVG, no script.
