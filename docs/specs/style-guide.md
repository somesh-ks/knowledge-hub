# Style guide

The reader's design system as its own site, "Singularity design": `news.someshks.work/design`, the app `apps/design`. What it does now. Reasons: D222, D189; plan: [command-center.md](../design/command-center.md).

## Requirements

- A static Astro app (`base: "/design"`, own Vercel project, reached by the reader's rewrite) drawn with the reader's own stylesheets, shell and navigation classes. A theme saved in the reader shows here (same origin). It is open and not indexed. The wordmark reads "Singularity" with a small "Design" chip; there is no link back to the reader.
- Pages: Overview, Colour, Type, Tokens, Principles. Every address carries the base.
- **Components are not here yet.** A component appears in the guide only when it is the one the app imports, so nothing shown can differ from the app (D222). The Overview says so. Until the app has a component per part, the guide lists none.
- **Overview.** The pages as rows, and a search over colour, type and token names (`/search-index.json`, read on first use; `/` focuses it; the query is kept in `?q=`).
- **Colour.** Every semantic role in its group, with the value it resolves to in the current theme (read through a canvas, so oklch shows as hex), the WCAG ratio of thirteen pairs the app uses against the ratio each needs, and the primitive ramps.
- **Type.** The nine roles with the size, weight and leading they resolve to at this window, a sample field that retypes them, the size scale and the leading.
- **Tokens.** Space, radius and stroke, shadow, motion (a press runs a duration or a curve, and the dot returns), layers, layout, component tokens and every icon; one filter hides what does not match.
- **Side column foot.** The day the guide was built, as the reader shows it, and the theme choice: System (follows the operating system), Light or Dark for this tab only (`sessionStorage`); the reader's saved preferences are never written. Below 64rem the Overview carries the theme choice.
- **Tests.** `npm run gate -- --build` type checks and builds the app.

## Code

- `apps/design/src` (pages, `scripts/`, `lib/`, `styles/guide.css`), `apps/design/vercel.json`
- `apps/web/src/lib/designCatalogue.ts` (tokens and usage comments)

## Gotchas

- A Settings view hides its switches until `data-ready`, so every guide page sets it.
- `--layout-column` stays 40rem: sheets and pickers are as wide as it makes them. Only the page's own column widens (`.shell.page`).
- The first build had a spec per shared part (44 files of hand-copied markup, with cards that stepped through states). The owner required the guide to show the real components, so it was removed from the pull request; see the [history note](../history/2026-10-29-style-guide.md).
