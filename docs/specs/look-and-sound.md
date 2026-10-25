# Look and sound

Visual language, covers and the header light, empty states, interface sounds, style rules. What it does now. Reasons: D31, D48, D54, D72, D73, D86, D96, D101, D110, D122, D125, D129; history: docs/history/.

## Requirements

### Visual language
- The reader follows Google Podcasts and Material 3 (D31, D72). Controls are tonal: a container fill, an accent container for the chosen or current one, 8% and 12% state layers, pill buttons, chips, selects and text fields (a multi-line field 24px, D186), 12px rows, no outline except on text fields.
- Story and summary text is 16px, headlines 18 to 20px, meta 14px, section headings (Settings H2s) 18 to 20px regular, never bold (D73, D125).
- A press never scales words: label controls and worded buttons show a press on their fill. Settings rows and menu options use a hover and press tile clear of the hairlines (`.row-action`): fully round on the page, the card's inner radius in a card. Segmented controls have a sliding thumb that moves at once when a key moves it (`data-input` on the root says key or pointer).
- Sideways scrollers (the section tabs, the Earlier shelf, the Costs table) fade their hidden edges by `.scroll-fade-inline`; concentric radii for cover frame and search clear; layer stacking uses `--z-beneath`, `--z-base`, `--z-raised`, `--z-overlay`.
- Dropdowns share one chevron gap. A glyph that ends a row lands its ink, not its box, where the words end (`--ink-end`, D187).
- A secondary action beside the hero's Play (Share) is `.btn-secondary.hero-share`: tonal, in Play's pill and height, as wide as its label, its touch area 44px (D153).
- Latest's navigation icon is a fire (outline, filled when current) (D129). Theme is a select in Appearance and draws no value until the stored one is set, so the page never flashes the default (D129).

### Covers and the header light
- Covers dated 2026-10 or later are drawn monthly (D110, `packages/cover/src/season.ts`, `MONTHLY_FROM`): one colour scheme a month; Daily and Weekly with set layouts (the weekly shows its ISO week number and Monday to Sunday range); On demand and episodes as a round plate on a matte; every draw held to 4.5:1 for type and 3:1 for form in code. Earlier covers keep mixed palettes.
- Covers are a step brighter and a little more saturated in both themes (paper chroma 0.045, spot and tint 25% richer, under the 0.12 cap); a card's progress scrim covers only its bottom quarter (D122).
- Ambient cover light (D48): a soft light in the cover's colours behind the header of Latest and of an episode, drawn by a small WebGL canvas on a GPU and by a CSS layer elsewhere. It reads its colours from the drawn cover for each theme (`coverColors`, not the palette id) and draws three round lights that drift; the CSS layer draws the same three (D122). Its GPU tests skip in headless Chromium, so CI covers only the CSS layer and the decision not to draw.
- Covers ship as lossless WebP (pixel-identical, about a third of the PNG bytes), encoded with sharp at build time and cached beside the PNG, which is still built for the lock screen's media controls.
- Safari lacks `overlay` and `interpolate-size`: the sheets, the Delete confirm, the hero menu and toasts place and stack themselves for their exit, the speed panel closes at once there, and heights do not animate to auto.
- Scenario: WHEN the theme changes THEN the covers on screen decode before the crossfade and the bars fade with the page.
- A topic's picture is drawn from its name and id (`packages/cover/src/topicArt.ts`).

### Empty states
- Every screen with nothing to show is one flat illustration, a title, one muted line and one filled action (D96): Latest with no briefing, an empty Library, a search or filter with no result (its line follows the search box in CSS), offline and back online, 404, and a topic with no sources (compact).
- The art is inline SVG in `EmptyArt.astro`, coloured by classes in `empty.css` from the theme's roles, `aria-hidden`, hidden under forced colours.

### Interface sounds
- Sounds are by kind of action (navigate, select, tap, open and close, success, failure) through one delegated listener that loads the sound code on the first gesture, key or focus and follows the Sounds setting (D101).
- Every enabled control makes one: an action button a soft tap, a dialog or popover its open and close including Escape, a toast its outcome. The first press of a page is queued until the engine is ready. A save that went through is silent.

### Style rules
- Spacing is 8pt: 8, 16, 24, 32, 48, 64, 96px, and 4px only where `ALLOWED_4PX` names it (D131). `npm run design-check` holds the grid, regular headings and token-only styles; `e2e/designSystem.spec.ts` checks the rendered grid on every page and open surface. Style tests also forbid raw lengths, undefined custom properties, and a width media query not in range syntax at a breakpoint's width (22.5, 40, 64, 80, 100rem). Unpinned: copy, geometry.
- Design fixes with a commented reason are extended, never rewritten.

### Design system enforcement
Three layers, each catching what the others miss (the owner's ask, 2026-10-21):
- Static: `npm run design-check` (`styles.test.ts`, about 2 s). Colour, type, space, radius, easing and z-index only from tokens; no colour literal in markup or script; icons only through the Icon component; a button, chip, pill or fab is a shared class or a named entry in `BESPOKE_CONTROLS`; no shadow on a control. Each rule's comment names the drift it prevents; an allowlist entry carries a reason.
- Hook: `.claude/hooks/design-check.mjs`, a PostToolUse hook on Edit, Write and MultiEdit for `apps/web/src/**` and `tokens/**`; silent when green, exit 2 with the failing rules when not.
- Audit: the `design-audit` agent (`.claude/agents/design-audit.md`) screenshots the touched pages at phone and desktop in light and dark and judges them against the ledger. A UI change runs it before the PR; `/close-session` checks it ran.
CI runs the rules in the unit tests and `designSystem.spec.ts` in the browser job on any PR touching `apps/web`, `packages` or `tokens`.
A component changes in the system, never on one page only (the owner, 2026-10-24): in its shared class, component or token, with its record in the same PR, the usage comment over its class, its ledger line and, for a new variant, this spec. The audit flags a shared class restyled in a page stylesheet. Variants: the segmented navigation's glyph tab (an icon alone, centred; Costs' chart and table switch) and its compact form (`.segmented-nav-compact`: chip height, 44px columns, a square pill under the glyph, `--segmented-nav-bg` for the track); the stat pill (a figure and its word, overlay tone); brand marks (`lib/brandMarks.ts`); `.scroll-fade-inline`, a sideways scroller's hidden edge fading while more lies past it (the Costs table, the section tabs, and the Earlier shelf at 40px by `--scroll-fade-size`), with `--scroll-fade-inset` for a pinned start column: the fade begins at its edge (the Costs dates, 2026-10-24). `.tabs-in-card`: a tab strip inside a card, its first label on the card's words (the Structure's kinds). A settings row that cannot act says `data-quiet` and its label goes muted (Volume with Sounds off, the Structure's frames). A sheet's header and a script-drawn menu come from `sheetHead.ts` (D188).

## Code
- `apps/web/src/pages/design/[...slug].astro` and `apps/web/src/lib/designCatalogue.ts`: the catalogue, dev and fixture builds only (D189)
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/primitives.css`
- `apps/web/src/styles/empty.css`
- `apps/web/src/components/EmptyArt.astro`
- `apps/web/src/scripts/ambientLight.ts`
- `packages/cover/src/season.ts`
- `packages/sound/src/engine.ts`
- `apps/web/src/scripts/uiSound.ts`
- Segmented controls come in two kinds (D132): a choice with a check for picking a value, and a sliding-pill tablist for switching views. Every full-screen sheet closes from the top right (`SheetHeader.astro`).
