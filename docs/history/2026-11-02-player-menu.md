# The player's ⋮ menu (D309)

The speed button under Play is gone. A ⋮ button on the player page opens the Menu: a bottom sheet with Download, Share and Save tiles on a phone, a plain list from 40rem. Playback speed is its second screen, a stepper (0.05x) and a slider with a stop at every 0.25x, so the slider is quick and the stepper is exact. Save is new: one `singularity:saved:<id>` key per podcast, listed newest first under Settings > Saved, which shares the Library list's two columns with Downloads from 80rem. Share is the Share fat glyph; Save is a bookmark.

It shipped in three pull requests because the gate keeps the design system and the app apart: #568 (tiles, a sheet head with Back, a value at a row's end, glyphs), #578 (a follow-up that moved the tile to the corner scale after #570 forbade a primitive radius, and trimmed `state.md`), #580 (the app). #580 changed `designSystem.test.ts` by one line, so the design-system check stayed red; it merged on the owner's standing "merge things too".

Tests rewritten with the speed button: the speed journey in `playback.spec.ts`, the script spec's speed step, two selectors in `stuck.spec.ts` and `surface.spec.ts`, the queue specs' `More for` queries (see learnings), the `speed-btn` entry in `designSystem.test.ts`, one page-override entry in `styles.test.ts`.

Not done: the tiles' menu roles (`menuitem` with `aria-checked`) need a selector in `menu.css`, and the tile classes need entries in `componentParts.ts`; both go in the next design-system batch.
