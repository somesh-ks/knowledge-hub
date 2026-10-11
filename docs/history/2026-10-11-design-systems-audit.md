# 2026-10-11: Design systems audit and component hygiene

Comprehensive design systems audit conducted with the sk-design-systems plugin (`design-debt-audit`, `design-tokens`, `accessibility`, `component-spec`). Full report in [design-systems-audit.md](../design-systems-audit.md).

## What changed and why
- Pruned dead token: removed orphaned `--row-gap: var(--space-2)` from `tokens/tokens.json` and regenerated `tokens.css`. Resolves the lingering TOK-dead-tokens finding from the design-engineering audit.
- Accessibility fix: added `aria-label="Cancel"` to the queue cancel button in `ManageChrome.astro`, satisfying WCAG 2.5.3 and 4.1.2 name requirements.
- Layer elevation tokenization (DD-004): defined semantic layer tokens in `tokens/tokens.json` (`--z-beneath: -1`, `--z-base: 0`, `--z-raised: 1`, `--z-overlay: 2`), eliminated all 16 raw integer z-index declarations across 7 component stylesheets (reaching 100% token coverage), and added an automated regression invariant test in `apps/web/src/styles/styles.test.ts`.
- Button and row state consolidation (DD-005): mapped `source-main` row hover and active states to canonical `var(--color-surface-sunken)`, and added fine-pointer hover styling to `.player-fallback-action` with `var(--color-accent-hover)`.
- Variant census: inventoried all 36 button class signatures across 31 files, establishing the canonical primitive mapping (`.btn`, `.icon-btn`, `.btn-primary`, `.btn-secondary`).
- Reduced motion analysis: documented the duration vs travel token architecture gap where collapsing duration tokens to 0.01ms suppresses opacity cross-fades under `prefers-reduced-motion: reduce`.

