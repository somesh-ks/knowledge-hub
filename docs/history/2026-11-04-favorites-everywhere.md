# 2026-11-04: Favorites from every podcast menu

The owner found no way to add a podcast to Favorites but the player's own menu. D365: a row "Add to favorites" / "Remove from favorites" first under the tiles of every podcast menu (`LibraryItemMenu.astro`, wired in `libraryMenu.ts`; `QueueRowMenu.tsx`), and a heart icon button after Play on a podcast page (`PlayCta.astro`, wired in `briefingPage.ts`) with a toast. The player's Favorite tile wears the heart too. The store did not change: one local storage key per item (`player/core/saved.ts`), announced by `singularity:saved`.

Taste was checked with a second model before building: a row rather than a fourth tile (a 360px sheet would wrap four labels), and action words that mirror "Add to queue". It suggested the bookmark and no toast; the owner asked for a heart and a toast, so those won.

The heart glyphs came through the design-system PR #661, so this PR merges after it. One browser journey covers the page heart, the Favorites page's row menu and the Library's row menu across a reload.
