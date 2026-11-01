# Live covers: one vector, recoloured by the page (D311)

Somesh asked for covers that follow the style without drawing one set per style ("programmatically change tokens"). The first build (raster per style) was dropped before merge.

## What changed

- A cover is one inline SVG. Its colours are slots (`k0` to `k7`, `s0` to `s7`) with light and dark numbers as custom properties.
- `cover.css` computes the style colour from the slot with relative `oklch()`, from `--cover-*` numbers that `buildTokens` writes from `tokens/covers.json`. Default paints the stored colour; browsers without relative colour keep Default.
- Type and figures keep the base lightness gap to the ground, times 1.1 (`HOLD_GAP`). A sweep of 6 months, 8 days, 4 kinds, 2 themes and every style (776 pairs) holds contrast; at 1.0 two Halloween pairs failed.
- Lettering is outlines in `/covers/glyphs.svg` (fontkitten, Schibsted Grotesk 500, 700, 900), so the vector needs no font. The wordmark shows only at the player size.
- Lock screen and share images stay Default-coloured rasters.
- The header light restyles hue and chroma in the browser (`ambientStyle.ts`); month tints stay server side.

## Why

A new style is now one entry in `covers.json`; nothing is drawn, stored or cached per style. The cost is a CSS formula that must equal the code mirror in `packages/cover/src/style.ts`; `style.test.ts` pins the numbers and `live.test.ts` the contrast.

## Next

The reader's hue slider (`--hue-shift`) is already read by covers and the light.
