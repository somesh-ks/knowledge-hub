# Style guide

The reader's design system as its own site: `news.someshks.work/design`, the app `apps/design`. What it does now. Reasons: D220, D189; plan: [command-center.md](../design/command-center.md).

## Requirements

- A static Astro app (`base: "/design"`, own Vercel project, reached by the reader's rewrite) drawn with the reader's own stylesheets, shell and navigation classes. A theme saved in the reader shows here (same origin). It is open and not indexed.
- Pages: Components, one page per component, Colour, Type, Tokens, Principles. Every address carries the base.
- **Specs.** Each shared part has a `*.design.ts` beside its component or stylesheet in `apps/web/src`, default-exporting `defineSpec(...)` (`lib/designSpec.ts`): id, title, level (atom, molecule, organism), category, the shared classes it draws, controls (choice, toggle, text), `render(state)` returning markup, optional `demo`, `frame`, `usage` and `guidance`. `lib/designSpecs.ts` collects them with `import.meta.glob`. The markup copies the shipped component; a change to the component changes its spec in the same PR.
- **Components page.** Cards in atomic order (Atoms, Molecules, Organisms), each the part drawn at its real size, scaled to fit its tile. Hovering or focusing a card steps the part through its states (the first choice's options, or a toggle flipped), editing nodes in place so the part's own transitions run; with reduced motion it shows its first step. The search matches components, classes, colours and tokens (`/search-index.json`, read on first use); level and category filter the cards; `/` focuses the search; the query is kept in `?q=`.
- **A component page.** The part live, a form of its controls (a toggle for each state, a choice for each variant, a text field for its words), every option of every control drawn at a glance, the usage comment read from over its class in the stylesheet, guidance, the markup (it follows the controls, with a copy button) and its classes. Tabs select and pressed buttons toggle in the stage; links go nowhere.
- **Colour.** Every semantic role in its group, with the value it resolves to in the current theme (read through a canvas, so oklch shows as hex), the WCAG ratio of thirteen pairs the app uses against the ratio each needs, and the primitive ramps.
- **Type.** The nine roles with the size, weight and leading they resolve to at this window, a sample field that retypes them, the size scale and the leading.
- **Tokens.** Space, radius and stroke, shadow, motion (a press runs a duration or a curve), layers, layout, component tokens and every icon; one filter hides what does not match.
- **Theme.** System, Light or Dark for this tab only (`sessionStorage`); the reader's saved preferences are never written.
- **Tests.** `lib/designSpecs.test.ts` fails when a spec id repeats, a spec claims a class it never draws or no stylesheet defines, or a class in `buttons.css`, `primitives.css`, `banner.css` or the shared list in the test has no spec. `npm run gate` type checks and builds the app.

## Code

- `apps/design/src` (pages, `scripts/`, `lib/`, `styles/guide.css`), `apps/design/vercel.json`
- `apps/web/src/lib/designSpec.ts`, `designSpecs.ts`, `designSpecs.test.ts`, `designCatalogue.ts` (tokens and usage comments)
- `apps/web/src/**/*.design.ts`

## Gotchas

- A card holds live parts, so it cannot be an anchor (an anchor in an anchor splits the card): its title is the link, stretched over the card, and the drawing is `inert`.
- The Library's `content-visibility: auto` leaves a scaled, clipped card blank; the guide turns it off for the cards it draws. A Settings view hides its switches until `data-ready`, so every guide page sets it.
- The top-layer parts (menu, toast, confirm, play-fab) carry an inline `style` to sit in place; it shows in the markup view.
- `--layout-column` stays 40rem: sheets and pickers are as wide as it makes them. Only the page's own column widens (`.shell.page`).
