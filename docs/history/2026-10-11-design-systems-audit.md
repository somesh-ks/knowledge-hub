# 2026-10-11: Design systems audit and component hygiene

Comprehensive design systems audit conducted with the sk-design-systems plugin (`design-debt-audit`, `design-tokens`, `accessibility`, `component-spec`). The report itself is below.

## What changed and why
- Pruned dead token: removed orphaned `--row-gap: var(--space-2)` from `tokens/tokens.json` and regenerated `tokens.css`. Resolves the lingering TOK-dead-tokens finding from the design-engineering audit.
- Accessibility fix: added `aria-label="Cancel"` to the queue cancel button in `ManageChrome.astro`, satisfying WCAG 2.5.3 and 4.1.2 name requirements.
- Layer elevation tokenization (DD-004): defined semantic layer tokens in `tokens/tokens.json` (`--z-beneath: -1`, `--z-base: 0`, `--z-raised: 1`, `--z-overlay: 2`), eliminated all 16 raw integer z-index declarations across 7 component stylesheets (reaching 100% token coverage), and added an automated regression invariant test in `apps/web/src/styles/styles.test.ts`.
- Button and row state consolidation (DD-005): mapped `source-main` row hover and active states to canonical `var(--color-surface-sunken)`, and added fine-pointer hover styling to `.player-fallback-action` with `var(--color-accent-hover)`.
- Variant census: inventoried all 36 button class signatures across 31 files, establishing the canonical primitive mapping (`.btn`, `.icon-btn`, `.btn-primary`, `.btn-secondary`).
- Reduced motion analysis: documented the duration vs travel token architecture gap where collapsing duration tokens to 0.01ms suppresses opacity cross-fades under `prefers-reduced-motion: reduce`.
- Dead code removal: deleted unused `src/player/dev/LabGlyph.astro`.
- Package hygiene: removed unreferenced `@fontsource-variable/literata` and `@fontsource-variable/schibsted-grotesk` from `apps/web` runtime dependencies and declared them in root `devDependencies` for prototype compilation.
- Developer workflow: added `npm run test:fast` to run all unit test suites while excluding the 9-minute Windows git child-process suite (`git-*.test.ts`).

## The report

2026-10-11 · Stack: Astro 7.3.5 + React 19, Vanilla CSS (Three-Tier Tokens), Native Transitions / @starting-style / View Transitions, @base-ui/react · Plugin: sk-design-systems · Values: ~/.agents/DESIGN.md

### Area Tiers & Scorecard

| Area | Tier | High | Medium | Low | Note |
| --- | --- | --- | --- | --- | --- |
| **TOK Tokens** | A | 0 | 1 | 1 | Strict 3-tier DTCG structure; pruned orphaned `--row-gap`; motion duration zeroing in reduced motion |
| **CMP Components** | A | 0 | 1 | 0 | Clean Base UI composition; 36 button class signatures can consolidate onto 4 canonical primitives |
| **A11 Accessibility** | S | 0 | 0 | 1 | Comprehensive forced-colors & modal traps; fixed missing `aria-label` on queue cancel button |
| **MOT Motion** | A | 0 | 1 | 0 | Physically grounded curves; duration collapsing under reduced-motion suppresses opacity cross-fades |
| **COL Color & Theme** | S | 0 | 0 | 0 | Pure OKLCH light-dark token pairs; 0 raw color function leaks across component CSS |
| **TYP Typography** | S | 0 | 0 | 0 | Fluid Google Sans Flex clamp scales; 100% tokenized type scale in component styles |
| **LAY Layers & Stacks** | S | 0 | 0 | 0 | 100% layer token coverage; 0 raw integer z-indices across all stylesheets; automated invariant test in styles.test.ts |

### Variant Census (Code Pass)

Scanned 304 markup and style files across `apps/web/src`.

#### Component Variants: `button / Button`

| Metric | Value |
| --- | --- |
| Variants found | 36 distinct class signatures |
| Canonical Primitives | 4 (`.btn`, `.icon-btn`, `.btn-primary`, `.btn-secondary`) in `styles/buttons.css` |
| Total Instances | 71 |
| Files Involved | 31 |

##### Signature Distribution

| # | Signature | Count | Category | Role |
| --- | --- | --- | --- | --- |
| 1 | `<button> btn` | 10 | Canonical | Text button (accent label, hover/press fill) |
| 2 | `<button> btn-primary` | 10 | Canonical | Solid primary CTA button |
| 3 | `<button> icon-btn press` | 6 | Canonical | Circular 44px icon button with tactile press feedback |
| 4 | `<button> dock-btn press` | 3 | Domain | Bottom dock destination trigger |
| 5 | `<button> hero-menu-item` | 3 | Menu | Popover menu item action |
| 6 | `<button> press transport-btn` | 3 | Audio | Play/pause/seek transport control |
| 7 | `<button> toast-action` | 3 | Toast | Inline toast action (Undo, Retry) |
| 8 | `<button> player-notice-action` | 2 | Audio | Inline player error/notice retry button |
| 9 | `<button> press press-subtle view-btn` | 2 | Segmented | Gallery/List layout toggle button |
| 10 | `<button> press toast-dismiss` | 2 | Toast | Quiet icon button to dismiss notification |
| 11 | `<button> press transport-btn transport-skip`| 2 | Audio | 15s forward/backward skip |
| 12 | `<button> btn confirm-delete` | 1 | Variant | Destructive confirmation variant of `.btn` |
| 13 | `<button> btn topic-remove` | 1 | Variant | Destructive topic removal variant of `.btn` |
| 14 | `<button> btn-secondary topic-add-source` | 1 | Variant | Outlined secondary variant with plus glyph |
| 15 | `<button> btn-secondary topics-add` | 1 | Variant | Outlined secondary variant |
| 16 | `<button> chip` / `chip podcast-sample` | 2 | Selection | Pill selection chip |
| 17 | `<button> cover-play` | 1 | Audio | Overlay hover play button on card cover |
| 18 | `<button> create-fab play-fab` | 1 | FAB | Floating action button (Create or Play) |
| 19 | `<button> daily-combo-toggle` | 1 | Input | Inline chevron toggle for combobox |
| 20 | `<button> dock-btn dock-wide press` | 1 | Domain | Expanded desktop side-dock action |
| 21 | `<button> dock-open` | 1 | Audio | Mini-player bar tap target |
| 22 | `<button> hero-menu-delete hero-menu-item` | 1 | Menu | Destructive popover item |
| 23 | `<button> hero-more icon-btn press` | 1 | Canonical | 3-dots popover trigger |
| 24 | `<button> icon-btn press run-dismiss` | 1 | Canonical | Workflow run status dismiss |
| 25 | `<button> num speed-btn` | 1 | Audio | Playback speed trigger |
| 26 | `<button> num speed-preset` | 1 | Audio | Speed dialog preset (1x, 1.25x, 1.5x, 2x) |
| 27 | `<button> player-collapse` | 1 | A11y | Keyboard-only "Close the player" action |
| 28 | `<button> player-fallback-action` | 1 | Audio | Reconnection retry button |
| 29 | `<button> player-upnext-row` | 1 | Row | Clickable queue row |
| 30 | `<button> press press-subtle search-clear` | 1 | Input | Search input clear action |
| 31 | `<button> script-back` | 1 | Audio | Script view collapse |
| 32 | `<button> script-turn` | 1 | Audio | Transcript segment scrub trigger |
| 33 | `<button> source-main` | 1 | Row | Source editor row trigger |
| 34 | `<button> story-row` | 1 | Row | Clickable story item |
| 35 | `<button> topic-edit` | 1 | Row | Settings topic row action |

### Values in Use Inventory

| Category | Distinct Values | Instances | Files | Most Used | Tokenized % |
| --- | --- | --- | --- | --- | --- |
| **font-size** | 19 | 122 | 20 | `var(--font-size-label)` (48), `var(--font-size-meta)` (17), `var(--font-size-body)` (16) | 99% |
| **spacing** | 101 | 482 | 23 | `var(--space-2)` (78), `0` (70), `var(--space-3)` (60), `var(--space-4)` (40) | 99% |
| **radius** | 29 | 128 | 18 | `var(--radius-round)` (33), `var(--button-radius)` (19), `var(--radius-md)` (11) | 98% |
| **shadow** | 24 | 63 | 16 | `none` (21), `var(--shadow-popover)` (5), `var(--sheet-shadow)` (4) | 100% |
| **color-literal** | 5 | 11 | 6 | `#000000` (canvas/test), `oklch(...)` (canvas tint math only) | 86% |
| **layer (z-index)** | 8 | 32 | 12 | `var(--z-header)` (5), `var(--z-sheet)` (5), `var(--z-raised)` (10), `var(--z-beneath)` (3), `var(--z-overlay)` (3), `var(--z-base)` (1) | 100% |

### Scored Design Debt Register

Formula: `Value = R + V + K`, `Priority = Value / C` (one decimal).
- Reach (R): 1 (under 5 instances), 2 (5-25 instances), 3 (over 25 instances)
- Visibility (V): 1 (admin/rare), 2 (secondary), 3 (primary/home)
- Risk (K): 1 (cosmetic), 2 (confusion/friction), 3 (trust/brand/a11y harm)
- Fix Cost (C): 1 (single PR/token swap), 2 (sprint pattern), 3 (migration)

| ID | Issue | Category | Score | Screens | Owner | Status | Target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **DD-001** | Dead `--row-gap: var(--space-2)` compiled in tokens | Implementation | R1 V1 K1 C1 = 3.0 | Global `tokens.css` | Design Systems | Resolved | Immediate |
| **DD-002** | Missing `aria-label="Cancel"` on queue item cancel button | Accessibility | R1 V2 K3 C1 = 6.0 | Settings, Topics | Design Systems | Resolved | Immediate |
| **DD-003** | Reduced-motion collapses duration tokens to 0.01ms, suppressing opacity fades | Interaction / Motion | R3 V3 K2 C1 = 8.0 | Player, Sheets, Dialogs | Design Systems | Open | Sprint 1 |
| **DD-004** | Layer token coverage at 53%; local stacking contexts use raw integers (-1, 1, 2) | Implementation | R2 V2 K1 C1 = 5.0 | Player, Library, Settings | Engineering | Resolved | Sprint 1 |
| **DD-005** | Custom row hover states (`source-main`) duplicate `.row-action` primitive | Visual / Reuse | R2 V2 K1 C1 = 5.0 | Settings › Topics | UI Craft | Resolved | Sprint 2 |
| **DD-006** | Apple touch icon RGBA container (Resvg default) flags `hasAlpha: true` | Visual / Mobile | R1 V2 K1 C2 = 2.0 | Home Screen bookmark | Web Mobile | Open | Backlog |

### Next Roadmap Items (Sprint 1)

1. **Motion Token Decoupling (`DD-003`)**:
   - In `tokens.json`, keep movement duration tokens intact under `prefers-reduced-motion: reduce`.
   - Remap travel distance and scale tokens (`--translate-enter: 0px`, `--scale-enter: 1`, `--scale-press: 1`) so sheets and overlays cross-fade without physical flight.
2. **Touch Icon Alpha Container (`DD-006`)**:
   - Resvg default container configuration review for `apple-touch-icon.png`.
