# 2026-11-02: the Library tab, list first

The owner's complaint (a long message to the coordinator): the thumbnail's flight into a podcast and back was bumpy and returned to a grid position, bottom cards landed low and came up, the card subtitle differed between list and grid, and the list carried more than the grid.

Causes, found by a frame probe on a 390px phone:

- The Library was drawn as a gallery at `astro:after-swap` and turned into the list at `astro:page-load`, so the cover flew to a grid card's box and then the page changed under it.
- A gallery of `content-visibility: auto` cards counted off-screen cards as a 240px estimate, so the saved offset was clamped (625 became 312) and the card landed far from where it was left.
- The subtitle's story count was hidden by container width in the gallery and in a list row with a menu, "Played" replaced the minutes, and the Downloaded mark was put first and wrapped onto its own line.

Changes: the list is the default and the first button; `libraryView.ts` sets the saved view at each swap before `coverMorph` measures, and draws a gallery's cards for two frames on a move back; the facts line is the same in both views, and Played and Downloaded are marks after it (`CardMarks.astro`). Only Today's shelf keeps "Played" in place of the length.

Later the same day the owner rejected the card marks and the weight of the line: no length, "Kind · N stories" for every card (a Catch up now says its stories too), no Played mark, and one Downloaded mark, an arrow with a flat line under it (no cup) in a blue circle. The glyph is Phosphor `arrow-line-down` (`arrowLineDown` in `tokens/glyphs.json`, a design-system change for the rolling PR); the circle is CSS, as the queue and player thread's circled glyphs are not in the icon set yet. A finished item now shows nothing on its card; `data-played` and the Today shelf's text swap are gone.
