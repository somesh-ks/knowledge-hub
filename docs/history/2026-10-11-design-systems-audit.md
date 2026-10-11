# 2026-10-11: Design systems audit and component hygiene

Comprehensive design systems audit conducted with the sk-design-systems plugin (`design-debt-audit`, `design-tokens`, `accessibility`, `component-spec`). Full report in [design-systems-audit.md](../design-systems-audit.md).

## What changed and why
- Pruned dead token: removed orphaned `--row-gap: var(--space-2)` from `tokens/tokens.json` and regenerated `tokens.css`. Resolves the lingering TOK-dead-tokens finding from the design-engineering audit.
- Accessibility fix: added `aria-label="Cancel"` to the queue cancel button in `ManageChrome.astro`, satisfying WCAG 2.5.3 and 4.1.2 name requirements.
- Variant census: inventoried all 36 button class signatures across 31 files, establishing the canonical primitive mapping (`.btn`, `.icon-btn`, `.btn-primary`, `.btn-secondary`) and the roadmap to consolidate custom row and utility triggers.
- Reduced motion analysis: documented the duration vs travel token architecture gap where collapsing duration tokens to 0.01ms destroys opacity cross-fades under `prefers-reduced-motion: reduce`.
