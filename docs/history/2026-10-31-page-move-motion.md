# 2026-10-31: page-move flicker and a motion audit (#501, D271, D272)

The owner saw the dock's caption, the nav pill and the Play button flicker on a move between pages, and called the page transitions "very poor and very robotic".

- Cause of the flicker: Astro takes each persisted island out of the leaving page and puts it into the arriving one, and an element put back starts every CSS animation again. A cached swap also cut the pill's growth a quarter of the way. Fixed in #501 by carrying each animation's time across the swap (`persistedMotion.ts`) and the pill's elapsed time (`--nav-pill-elapsed`).
- Audit: the tokens and the spec were sound (the CSS held two ad hoc values). The robotic feel came from the move itself, a hard cut and a 100 ms fade, a pill that did not travel, and no cover that carried you in. transitions.dev was read and not installed: it animates blur, runs 350 to 500 ms and bounces, against the spec.
- Change: the pill slides between tabs, a cover flies between card and hero, both 250 ms on the out curve (D271; they first rode the 420 ms spatial spring and felt slower to the owner). No floating button is persisted (D272).
- Checked: per-frame probes of the pill and the flight at 390px, a test for each that fails without the change (`navSpeed.spec.ts`), both browser suites. Not checked on a real phone.
- Left: the Play morph, the wavy scrubber and the morphing loader stay held, each its own design-system PR; the side column's rows still fade.

## Afterwards (D280)

On his phone the 250 ms flight was "too quick and jerky" and the pill's slide "doesn't feel natural". A per-frame sample showed why: the out curve has done 28% of the travel in the first frame and half in 33 ms, and its fade is at 93% after 40 ms, so any length of it reads as a cut. Four curves were recorded on the flight; the hover curve at the sheet's 300 ms has the smallest peak step and no tail, so the flight, the page's slide and the pill's growth share it. The pill now grows in place (his pick of three: grow, fade with a scale, fade), the two slide tests went with the slide, and tab moves keep the time of a press (`navSpeed.spec.ts` caps them). The same PR makes the whole bar, the strip above the home indicator included, a tab's touch area: only that strip was dead on a phone, and it was not caused by a recent PR.


He tried it on his phone on 2026-11-01: "works!". The state line for it is closed.
