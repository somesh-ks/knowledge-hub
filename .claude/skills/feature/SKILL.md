---
name: feature
description: "Build and share production-grade features in Singularity: enforces a 1-page contextual feature brief, 7-state audit (with explicit N/A justification), canonical control archetypes, and multi-layer verification (design-check, gate, bundle check, browser suites, visual screenshots, and CodeRabbit review). Use when asked to build a new feature, add interactive UI, modify user flows, or when the user invokes /feature."
---

# Feature Development Protocol

Builds fully baked, production-grade features for Singularity. Enforces upfront clarity, strict design system compliance, budget preservation, and multi-layer verification before declaring completion.

## Step 0: Early Status & Delta Check

Before starting work or modifying files, run a lightweight status check:
```bash
python .claude/skills/feature/scripts/verify_feature.py --status
```
If the status check reveals pending uncommitted changes from another task, stop immediately and ask for guidance before proceeding.

---

## Phase 1: Contextual Feature Brief & State Audit

When starting a new feature or non-trivial UI change, explore the codebase and existing design tokens first. Then generate a 1-page Feature Brief using [assets/feature-brief-template.md](assets/feature-brief-template.md) containing:

### 1. Intent and User Journey
- **User Problem**: Specific user friction or need this solves.
- **Primary Flow**: Step-by-step path the user takes.
- **Success Criteria**: Exact observable behavior when complete.
- **Reference Product**: Reference design being matched (e.g. Google Podcasts, YouTube Music, Material 3).

### 2. Contextual State Audit Matrix
Audit all seven canonical states. Any state that does not apply must be explicitly justified:
- **Idle**: Resting appearance and default content.
- **Loading / Skeleton**: Layout-stable placeholder without layout shift.
- **Active / Focused**: Pressed, toggled, or playing state.
- **Empty**: Contextual empty art, headline, and single CTA.
- **Error / Retry**: Inline failure message with a clear recovery trigger.
- **Disabled**: Dimmed tonal surface (`data-quiet`), unclickable, preserved in DOM.
- **Offline**: Cached fallback state or clear offline badge.
- **Requirement**: If a state is not applicable, write: `N/A: [One-line rationale]`.

### 3. Canonical Control Archetypes (Inlined Decision Matrix)
Select exclusively from the shared control archetypes below. Never invent bespoke control classes.

| Archetype | Class / Element | Primary Purpose | When to Use |
| :--- | :--- | :--- | :--- |
| **Primary Button** | `.btn-primary` | High-emphasis trigger | Single primary action per card/surface (Hero Play, Submit). |
| **Secondary Button** | `.btn-secondary` | Medium-emphasis companion | Paired alongside primary (Share, Cancel, Dismiss). |
| **Tonal Button** | `.btn` | Low-emphasis neutral trigger | Standard surface actions (Settings head links, Filters). |
| **Icon Button** | `.icon-btn.press` | Single glyph action | Compact controls (Close, Edit, More options). Needs `aria-label`. |
| **Action Chip** | `.chip` | Status + action pill | Duration, playback pill. Uses fixed-width sizer copies. |
| **Filter Chip** | `.filter-chip` | Multi-select toggle | Category and format filtering. Wraps checkbox or radio input. |
| **Segmented Nav** | `.segmented-nav-tab` | View switcher | Sliding pill tablist switching active view (Stories vs Transcript). |
| **Segmented Choice**| `.segmented-choice-item` | Single option picker | Radio group for discrete values (3 min, 5 min, 10 min). |
| **Row Action** | `.row-action` | Row navigation trigger | Settings and menu rows acting as pressable tiles off hairlines. |
| **Bottom Sheet** | `.sheet`, `BottomSheet.astro` | Mobile modal drawer | Lists, menus, and selects on viewports under 40rem; never popovers. |
| **Floating Action** | `CreateFab.astro`, `AddFab.astro` | Floating action trigger | Prominent mobile creation triggers pinned above bottom dock. |

> Read [references/controls-guide.md](references/controls-guide.md) only for ambiguous cases, full markup snippets, or bespoke controls.

### 4. Design System & Budget Contract
- Identify exact semantic tokens to be used (`--color-surface-*`, `--space-*`, `--radius-*`).
- Verify 8pt spatial grid compliance (4px only for designated micro-alignments).
- **Phone-First Rule**: On viewports under 40rem, menus and selects open as bottom sheets, not popovers (D167, Ledger section 11).
- **First-Load JS Ceiling**: Keep first-load script strictly under the 130 KB gzipped ceiling (`FIRST_LOAD_BUDGET_BYTES`, D141). React islands wake on interaction via `client:wake` (D178).

> **Approval Gate**: If the feature introduces unresolved visual, layout, or product decisions, halt and request confirmation from the owner. If requirements and tokens are already fully defined, proceed directly to Phase 2.

---

## Phase 2: Surgical Implementation

1. **Reuse Existing Primitives**: Never invent new button or control classes. Reuse existing classes documented in the decision matrix.
2. **Preserve Load-Bearing Rules**: Never remove or rewrite CSS rules or markup containing rationale comments (dates, D-numbers, sizers, specificity bumps).
3. **No Layout Shift**: Ensure labels on dynamic buttons or chips use fixed-width sizer copies or stable gutters so text does not shake.
4. **Regular Headings**: Heading elements and button labels stay regular weight (400 or 500); never bold (D73, D125).
5. **No Text Scaling on Press**: Worded controls show press via tonal fill overlay; never scale text down.

---

## Phase 3: Multi-Layer Verification & Review

Before declaring the feature complete, execute all required checks in sequence:

1. **Preflight Token & Style Check**:
   Run `python .claude/skills/feature/scripts/verify_feature.py --check` to verify no raw hex colors, zero em dashes, and passing `npm run design-check`.
2. **Repository Gate & Build**:
   Run `npm run gate -- --build` to verify TypeScript, Astro diagnostics, Biome linting, unit tests, docs budgets, the static build, and `postbuild` bundle budget check in parallel.
3. **First-Load Bundle Budget Check**:
   Verify bundle output via `npx tsx apps/web/scripts/checkBundle.ts` (enforcing the 130 KB budget ceiling against the fresh build).
4. **Browser Suites (for UI Changes)**:
   Run `npm run e2e -w @singularity/web` and `npm run e2e:player -w @singularity/web`.
5. **Visual Screenshot Inspection**:
   Capture screenshots at 390x844 (phone) and 1526x782 (desktop) in light and dark themes. Verify open states (open sheets, active player, focused fields) by eye.
6. **CodeRabbit Second Opinion**:
   Run `coderabbit review --agent` (via `code-review-rabbit` skill) on the diff to catch edge cases, concurrency regressions, and accessibility flaws.
7. **Record Update & 2-Minute Test Close**:
   Update [docs/state.md](../../../docs/state.md), record any architectural direction change in [docs/decisions.md](../../../docs/decisions.md), and note UI changes in [docs/design-engineering-ledger.md](../../../docs/design-engineering-ledger.md). Close with one concrete, 2-minute verification action on localhost (e.g. `http://localhost:4321/...`).
