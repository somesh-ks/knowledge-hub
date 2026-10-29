# Style guide

The reader's design system as its own site, "Singularity design": `news.someshks.work/design`, the app `apps/design`. What it does now. Reasons: D226, D224; plan: [command-center.md](../design/command-center.md).

## Requirements

- A static Astro app (`base: "/design"`, own Vercel project, reached by the reader's rewrite, and its own `/design` rewrites for the standalone project) drawn with the reader's own stylesheets, shell and navigation classes. It is open and not indexed. The wordmark reads "Singularity" with "Design" set close beside it as one lockup; there is no link back to the reader.
- **Navigation.** Overview, Principles, Foundations (Color, Typography, Motion, Tokens), Components. The side column opens Foundations into its pages (an accordion in one rounded tonal container, the one group that has pages); the bottom bar shows the four top-level pages, and Foundations there opens a page that lists its pages. Icons are Phosphor, outline at rest and filled when current. A page below Foundations shows a back arrow in the phone's app bar; there are no breadcrumbs, because the side column already shows where you are.
- **Principles.** The ten principles as cards (a colored icon, a title, one line, the decision numbers that hold the reasoning), the refused patterns as chips, and how drift is caught as three cards. Cards rise in and the icon tilts on hover. A Taste page may join it later.
- **Components are not here yet.** A component appears in the guide only when it is the one the app imports, so nothing shown can differ from the app (D226). The Components page says so, and that each component page will carry plain "use when / do not use when" decision points for a person or an agent choosing a part.
- **Overview.** A hero of six shapes made of the app's tokens, and three cards (Principles, Foundations, Components). Foundations opens a page of cards for its pages. A card's note is one line. Each picture is drawn in its own colors, plays in once on load, and moves again on hover or focus (only where the reader allows motion). No search here; each page filters its own content.
- **Color.** A toolbar (search "Search colors" and a tier filter: All, Semantic, Primitive, Component, both as tall as a text field) that sticks under the app bar. Semantic roles by group, each drawn as it is used (a text role on the surface it sits on) with its OKLCH and hex in the current theme and the WCAG 2 ratio of that pair (AAA from 7, AA from 4.5, AA large from 3; a translucent role shows "translucent"); the thirteen pairs the app uses; primitive ramps with step numbers; component tokens pointing at the role they use. The swatch's ink and text share one left edge.
- **Typography.** The typeface, the nine roles with the size, weight and leading they resolve to at this window, a sample field that retypes them, the size scale and the leading; a filter narrows roles and sizes (the search sticks like Color's).
- **Motion.** Durations and curves (a press runs one, and the dot returns), and the press, hover and enter tokens; a filter narrows them. The expressive motion work extends this page.
- **Tokens.** Space, radius and stroke, shadow, layers, layout, component tokens and every icon; a filter narrows them.
- **Theme.** One secondary icon button, in the app bar below 64rem and above the date in the side column's foot from it, switches light and dark. It shows where a press goes. The guide opens dark; the choice is kept in this browser under `design:theme`. The reader's saved preferences are never read or written. The foot also shows the day the guide was built.
- **Tests.** `npm run gate -- --build` type checks and builds the app.

## Code

- `apps/design/src` (pages, `scripts/`, `lib/`, `styles/guide.css`), `apps/design/vercel.json`
- `apps/web/src/lib/designCatalogue.ts` (tokens and usage comments)

## Gotchas

- A Settings view hides its switches until `data-ready`, so every guide page sets it.
- `--layout-column` stays 40rem: sheets and pickers are as wide as it makes them. Only the page's own column widens (`.shell.page`).
- The first build had a spec per shared part (44 files of hand-copied markup, with cards that stepped through states). The owner required the guide to show the real components, so it was removed from the pull request; see the [history note](../history/2026-10-29-style-guide.md).
