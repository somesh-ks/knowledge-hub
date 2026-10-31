# 2026-10-31: page-move flicker and a motion audit (#501, D271, D272)

The owner saw the dock's caption, the nav pill and the Play button flicker on a move between pages, and called the page transitions "very poor and very robotic".

- Cause of the flicker: Astro takes each persisted island out of the leaving page and puts it into the arriving one, and an element put back starts every CSS animation again. A cached swap also cut the pill's growth a quarter of the way. Fixed in #501 by carrying each animation's time across the swap (`persistedMotion.ts`) and the pill's elapsed time (`--nav-pill-elapsed`).
- Audit: the tokens and the spec were sound (the CSS held two ad hoc values). The robotic feel came from the move itself, a hard cut and a 100 ms fade, a pill that did not travel, and no cover that carried you in. transitions.dev was read and not installed: it animates blur, runs 350 to 500 ms and bounces, against the spec.
- Change: the pill slides between tabs, a cover flies between card and hero, both on the default spatial spring (D271). No floating button is persisted (D272).
- Checked: per-frame probes of the pill and the flight at 390px, a test for each that fails without the change (`navSpeed.spec.ts`), both browser suites. Not checked on a real phone.
- Left: the Play morph, the wavy scrubber and the morphing loader stay held, each its own design-system PR; the side column's rows still fade.
