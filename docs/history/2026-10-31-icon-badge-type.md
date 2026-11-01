# Icon, Badge and type roles

2026-10-31. D243 parts E and F, after #488 merged.

## What happened

Type roles got their users (D266): seven page rules that restated a role are gone. The Astro `.icon` and React `.ui-icon` became `icon-glyph`; `Icon.astro` joined the design system. The Admin tag and the guide's fold count became one Badge. Card and Row were judged tokens, not components (D267); the source and score cards take the 32px card radius.

## Proof

`parity.cjs` (every element's computed style and box on 27 pages, 390 and 1280, light and dark, base build against after) found one difference: the player's hidden collapse chip, whose ink had been decided by stylesheet order. Browser suites: see the PR.

## Left

An Icon size scale; row and card variants only if a second look is asked for.
