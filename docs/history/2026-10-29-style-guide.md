# 2026-10-29: the style guide as its own app

The owner opened `/design`, found it missing on production, and asked for the admin pages and the design catalogue to leave the reader: a command center at `/admin`, a style guide at `/design`, both in the app's own language (the first attempt looked like another product). This note is the style guide's half (D220); the command center is its own thread (PR #421).

## What was built

- `apps/design`, a static Astro app with base `/design`, importing the reader's stylesheets, shell and nav classes by relative path, as `apps/admin` does.
- One spec per shared part, `*.design.ts` beside it, 44 in all: strings of markup written from the shipped components, with controls for each variant and state. Four workers wrote them in parallel by family (actions, inputs, navigation and lists, feedback and overlays) from one brief; I read every screenshot of the index and a sample of the component pages. A test fails on a shared class without a spec.
- Pages from the old catalogue's content: colour (now with the live value and WCAG ratio of thirteen pairs, measured through a canvas), type (resolved size, weight and leading, a sample field), tokens (motion tokens run on a press, icons), principles (written from `PRODUCT.md`, the ledger and the decisions; each D-number checked against the Index).
- Mobbin references (in the command-center plan) steered the layout: a search above category chips and a grid of cards, a component page of preview, controls and code.

## What went wrong on the way

- The first card was an anchor around the drawing; five parts contain links, so the parser split the card and left blank tiles. The fix is the stretched title link with an inert drawing.
- The drawings first overflowed their tiles. A fixed scale looked wrong for every part; one measured scale per tile (never up, never below 0.3) did not.
- `--layout-column` widened to fit three cards also widened the sheet and picker specs. Only the page's own column widens now.
- A Settings view hides its switches until `data-ready`, so every switch drew as a grey pill.
- Hex colours in two card specs failed the house rule `no color literals`; they use theme tokens.

## Left for later

- The markup is hand-copied from the components and can drift; a check that renders the `.astro` through Astro's container API and compares it is the next step if it does.
- The reader's own `/design` page stays until the rewrite is live.
- Not seen: Safari and WebKit, a real phone, a keyboard-only pass of the controls.
