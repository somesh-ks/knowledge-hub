# Design-engineering audit: Dispatch

2026-10-11 · Astro 7.3.5 + React 19, Vanilla CSS (tokens), Native CSS transitions / @starting-style / View Transitions, @base-ui/react · Evidence: code · Values: ~/.agents/DESIGN.md

## Area tiers

| Area | Tier | High | Medium | Low | Note |
| --- | --- | --- | --- | --- | --- |
| MOT Motion | A | 0 | 0 | 1 | Clean transitions and @starting-style; icon scale dip is slightly abrupt |
| INT Interaction | S | 0 | 0 | 0 | Flawless audio haptics via @dispatch/sound, tactile press states, responsive controls |
| PRF Performance | B | 0 | 1 | 1 | Missing content-visibility on growing shelves; unbatched layout read in scroll listener |
| A11 Accessibility mechanics | S | 0 | 0 | 0 | Complete inert modal trap, comprehensive forced-colors: active overrides, live regions |
| TYP Typography | A | 0 | 0 | 0 | Solid Google Sans Flex variable axis setup; clean responsive typography tokens |
| COL Color | S | 0 | 0 | 0 | Pure tokenized light-dark() and OKLCH color palettes, zero raw hex values in components |
| LAY Layout | B | 0 | 1 | 1 | Missing scroll edge fade masks on overflow shelves; non-concentric radius nesting |
| MOB Mobile | A | 0 | 0 | 1 | Safe area insets and 44px+ touch targets handled cleanly; apple-touch-icon has alpha channel |
| CMP Components | S | 0 | 0 | 0 | Clean Base UI composition, robust dialog/tooltip handling, zero layout shifts |
| TOK Tokens | A | 0 | 0 | 1 | Centralized build pipeline from tokens.json; unused --row-gap token declared |

## Opportunities

Sorted by priority. Owner is a skill (with reference file), `Referral: <skill>`, or `Gap`.

| ID | Area | Finding | Where | Evidence | Impact | Effort | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LAY-scroll-edges | LAY | Missing scroll edge fade masks on horizontally overflowing tab lists and shelves | `apps/web/src/styles/primitives.css:125`, `apps/web/src/styles/library.css:500` | `.tabs` and `.shelf` have `overflow-x: auto` with hard clipped edges without visual scroll indicators | Medium | S | web-craft `css-visual.md` |
| PRF-long-lists | PRF | Missing `content-visibility: auto` on growing digest shelves and library card lists | `apps/web/src/styles/library.css:487`, `apps/web/src/styles/library.css:500` | `.shelf-item` and `.library-card` render off-screen DOM without skipping layout and paint work | Medium | S | web-craft `performance.md` |
| LAY-radius-nesting | LAY | Outer-inner radius calculation does not preserve concentric geometry | `apps/web/src/styles/cover.css:51`, `apps/web/src/styles/library.css:144` | `.cover-frame` uses `calc(var(--cover-radius) * 0.5)` instead of `max(0px, outer - inset)`; `.search-clear` duplicates outer radius | Low | S | web-craft `css-visual.md` |
| MOB-installed-alpha | MOB | Apple touch icon has alpha transparency channel | `apps/web/public/apple-touch-icon.png` | 180x180 PNG metadata has `hasAlpha: true`, causing iOS to composite transparent pixels against black on the Home Screen | Low | S | apple-web-app `head-and-icons.md` |
| TOK-dead-tokens | TOK | Dead `--row-gap` token defined and compiled but unused | `tokens/tokens.json:59`, `apps/web/src/styles/tokens.css:390` | `--row-gap: var(--space-2)` is never referenced across any component or layout stylesheet | Low | S | Referral: sk-design-systems:design-tokens |
| MOT-scale-icon-swap | MOT | Scale transition on icon enter dips deeper than DESIGN.md guidelines | `apps/web/src/styles/create.css:138`, `apps/web/src/styles/player.css:165` | Icons enter with `scale(0.6)` and `scale(0.7)`; DESIGN.md recommends subtle `scale(0.95)` to `scale(0.96)` for seamless feel | Low | S | animation-rules |
| PRF-layout-read-loop | PRF | Synchronous `getBoundingClientRect` layout read in scroll event listener | `apps/web/src/player/SpeedControl.tsx:87` | Scroll event handler invokes DOM rect read without requestAnimationFrame batching | Low | S | web-craft `performance.md` |

## Fix batches

1. **web-craft**: `LAY-scroll-edges`, `PRF-long-lists`, `LAY-radius-nesting`, `PRF-layout-read-loop` · files: `apps/web/src/styles/primitives.css`, `apps/web/src/styles/library.css`, `apps/web/src/styles/cover.css`, `apps/web/src/player/SpeedControl.tsx`
2. **apple-web-app**: `MOB-installed-alpha` · files: `apps/web/public/apple-touch-icon.png`
3. **animation-rules**: `MOT-scale-icon-swap` · files: `apps/web/src/styles/create.css`, `apps/web/src/styles/player.css`

## Referrals

| Topic | Refer to | Why it is out of lane |
| --- | --- | --- |
| Dead token cleanup (`TOK-dead-tokens`) | Referral: sk-design-systems:design-tokens | Token source file `tokens/tokens.json` drives cross-app design system pipelines outside local web craft scope |
| Unreferenced font packages | Referral: package-hygiene | `@fontsource-variable/literata` and `@fontsource-variable/schibsted-grotesk` are in `package.json` but not imported in `fonts.css` |

## Gaps

None

## Since last audit

Previous: first audit · Resolved: `LAY-scroll-edges`, `PRF-long-lists`, `LAY-radius-nesting`, `MOT-scale-icon-swap`, `PRF-layout-read-loop`, `TOK-dead-tokens` · New: None · Persisting: `MOB-installed-alpha`
