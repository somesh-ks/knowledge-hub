# Look and sound

Visual language, covers and the header light, empty states, interface sounds, style rules. What it does now. Reasons: D31, D48, D54, D72, D73, D86, D96, D101, D110, D122, D125, D129; history: docs/history/.

## Requirements

### Visual language
- The reader follows Google Podcasts and Material 3 (D31, D72). Controls are tonal: container fill, accent container for chosen/current item, 8% and 12% state layers, pill buttons (Catch up: `.btn-action-tonal`, flat, 16px), chips, selects, text fields (multi-line 24px, D186), 12px rows, no outline except on text fields.
- Story and summary text is 16px, headlines 18 to 20px, meta 14px, section headings (Settings H2s) 18 to 20px regular, never bold (D73, D125).
- A press never scales words: label controls and worded buttons show a press on their fill. Settings rows and menu options press as a tile off hairlines (`.row-action`), round on the page, concentric in a card (one-row card radius 24px, a third of height). Segmented controls have a sliding thumb that moves immediately with keys.
- Sideways scrollers (section tabs, Earlier shelf, Costs table) fade hidden edges with `.scroll-fade-inline`; concentric radii for cover frame and search clear; layer stacking: `--z-beneath`, `--z-base`, `--z-raised`, `--z-overlay`.
- Dropdowns share one chevron gap. Glyphs ending a row land ink at the word end (`--ink-end`, D187).
- Hero Share action is `.btn-secondary.hero-share`: tonal, Play's pill and height, touch area 44px (D153).
- Latest icon is a bolt (outline, filled when active) (D129, D168). Theme select in Appearance renders blank until stored value loads to avoid theme flashes (D129).

### Covers and the header light
- Covers dated 2026-10 or later draw monthly (D110, `packages/cover/src/season.ts`, `MONTHLY_FROM`): set layout for Daily and Weekly (weekly shows ISO week number and range); On demand and episodes use a round plate on matte; type 4.5:1, spot ink 3:1 on paper. Earlier covers keep mixed palettes.
- Covers have richer saturation in both themes (paper chroma 0.045, spot and tint 25% richer, under 0.12 cap); card progress scrim covers bottom quarter only (D122).
- Ambient light (D48): soft cover-colored light behind Latest and episode headers, drawn by WebGL canvas on GPU and CSS layer fallback (D122).
- Covers ship as lossless WebP (about 1/3 PNG bytes), encoded with sharp at build time; PNG retained for lock screen media controls.
- Safari workarounds: sheets, Delete confirm, hero menu, and toasts stack for exit; speed panel closes immediately; heights do not animate to auto.
- Scenario: WHEN theme changes THEN covers decode before crossfade and bars fade with page.
- Topic artwork generated from name and id (`packages/cover/src/topicArt.ts`).

### Empty states
- Screens without content show one flat illustration, title, muted line, and one filled action (D96): Latest without briefing, empty Library, search/filter without result, offline/online transitions, 404, empty topic or Structure list.
- Art is inline SVG in `EmptyArt.astro`, styled via `empty.css` roles, `aria-hidden`, hidden in forced colors.

### Interface sounds
- Sounds categorize by action (navigate, select, tap, open, close, success, failure) via one delegated listener loading on first gesture and following Sounds setting (D101).
- Enabled controls trigger cues: action buttons soft tap, dialogs/popovers open/close including Escape, toasts outcome. Silent after successful save.

### Style rules
- Spacing is 8pt: 8, 16, 24, 32, 48, 64, 96px, with 4px only where `ALLOWED_4PX` names it (D131). `npm run design-check` enforces grid, regular headings, and token-only styles; `e2e/designSystem.spec.ts` verifies rendered grid across pages. Tests forbid raw lengths, undefined custom properties, and non-range media queries.
- Design fixes with commented rationale are extended, never rewritten.

### Design system enforcement
Three layers catch regressions (owner, 2026-10-21):
- Static: `npm run design-check` (`styles.test.ts`, about 2 s). Enforces tokens for color, type, space, radius, easing, z-index; no color literals; icons via Icon component; controls match shared classes or `BESPOKE_CONTROLS`; no box-shadows.
- Hook: `.claude/hooks/design-check.mjs`, PostToolUse hook on Edit/Write for `apps/web/src/**` and `tokens/**`.
- Audit: `design-audit` agent (`.claude/agents/design-audit.md`) screenshots pages at mobile and desktop viewports in light and dark before PRs.
CI runs rules in unit tests and `designSystem.spec.ts` in browser suite. Components change in shared class, component, or token with ledger records in one PR (owner, 2026-10-24).
Key variants: `.segmented-nav-compact` (chip height, 44px columns); `.stat-tile` (metric over label, 2-4 columns); `.status-dot` (8px, status tones); `.scroll-fade-inline` (overflow edge mask with `--scroll-fade-inset`); `.tabs-in-card`; `data-quiet` (muted disabled rows); `sheetHead.ts` header/menus (D188); `.confirm-actions.is-stacked` (unsaved-changes modal from `sheetGuard.ts`); `.queue-dock`, `.queue-row`, `.queue-ring`, `.queue-pop` (the podcast queue, D216, `queue.css`).

### Agentic design conventions
Coding agents building or modifying UI follow these contracts (adapted from Astryx best practices):
- **Token purity**: Never write hex codes, rgb/hsl, or literal pixel spacing in CSS or inline styles. All visual properties map to CSS custom properties derived from `tokens/tokens.json`.
- **Headless behavior**: Use unstyled accessible primitives (`@base-ui/react`) for popovers, dialogs, and sheets; apply styling via Singularity component classes.
- **Zero layout shift**: Controls hold fixed box dimensions across states (hover, active, played, checked). Use hidden sizers or absolute positioning for state icons.
- **Verification**: Run `npm run design-check` after modifying any CSS or markup to ensure instant adherence to house rules.

## Code
- `apps/web/src/pages/design/[...slug].astro` and `apps/web/src/lib/designCatalogue.ts`: catalogue (D189)
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/primitives.css`
- `apps/web/src/styles/empty.css`
- `apps/web/src/components/EmptyArt.astro`
- `apps/web/src/scripts/ambientLight.ts`
- `packages/cover/src/season.ts`
- `packages/sound/src/engine.ts`
- `apps/web/src/scripts/uiSound.ts`
- Segmented controls have two kinds (D132): choice with check for picking value, and sliding-pill tablist for view switching. Full-screen sheets close from top right (`SheetHeader.astro`).
