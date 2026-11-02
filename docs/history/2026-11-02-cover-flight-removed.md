# 2026-11-02: the cover flight removed (D336)

The owner: "remove the morph animation as it doesnt make sense". The cover that left its card and settled as the page's hero (D271, D280) is gone: `scripts/coverMorph.ts`, `.cover-morph` and `[data-morphing]` (`cover.css`), its journey test and `installCoverMorph()`.

- Kept: the page's fade and 8px settle (D280), and the player's own mini to full cover morph (`player/core/coverMorph.ts`).
- The Library tab thread (#597) keeps `installLibraryViewSwap()` and its card-returns-to-its-place check; only its flight assertion goes.
