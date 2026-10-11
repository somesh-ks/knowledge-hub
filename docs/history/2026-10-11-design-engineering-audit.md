# 2026-10-11: Design-engineering audit and craft polish

Audit pass conducted with the sk-design-engineering plugin, covering all ten craft areas across the web app. Full audit report is in [design-engineering-audit.md](../design-engineering-audit.md).

## What changed and why
- Scroll edge fades: `.tabs` in primitives and `.shelf` in the Library now fade their overflowing edges with CSS `@property` and `animation-timeline: scroll(self inline)` without hard clipping or layout reflows.
- Off-screen cards: `.library-grid > .card` and `.shelf > .card` use `content-visibility: auto` to defer layout and paint for off-screen cards as the library grows.
- Concentric geometry: `.cover-frame` uses `max(0px, outer - inset)` to preserve concentric corners; `.search-clear` follows concentric radius geometry.
- Scroll measurement: `SpeedControl.tsx` batches `getBoundingClientRect` reads inside window scroll listeners with `requestAnimationFrame` to eliminate layout thrashing.
- Motion scales: icon swap transitions in `create.css`, `player.css`, and `buttons.css` tuned to standard `scale(0.95)` per design rules.
