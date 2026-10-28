---
name: feature
description: "Build and share production-grade features in Singularity: enforces a 1-page contextual feature brief, 7-state audit (with explicit N/A justification), adherence to canonical control archetypes, and multi-layer verification (design-check, gate, browser suites, and CodeRabbit review). Use when asked to build a new feature, add interactive UI, modify user flows, or when the user invokes /feature."
---

# Feature Development Protocol

Builds fully baked, production-grade features for Singularity. Enforces upfront clarity, strict design system compliance, and rigorous machine verification before declaring completion.

## Phase 1: Contextual Feature Brief & State Audit

When starting a new feature or non-trivial UI change, explore the codebase and existing design tokens first. Then generate a 1-page Feature Brief containing:

### 1. Intent and User Journey
- **User Problem**: What specific user need or scenario this solves.
- **Primary Flow**: The step-by-step path the user takes.
- **Success Criteria**: Exact observable behavior when complete.

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

### 3. Design System Contract
- Consult [references/controls-guide.md](references/controls-guide.md) before writing any control markup. Select exclusively from the shared control archetypes documented in the guide (primary, secondary, and tonal buttons, icon buttons, action chips, filter chips, segmented navigation, segmented choice, row actions, and floating actions).
- Identify exact semantic tokens to be used (`--color-surface-*`, `--space-*`, `--radius-*`).
- Verify 8pt spatial grid compliance (4px only for designated micro-alignments).

> **Approval Gate**: If the feature introduces unresolved visual, layout, or product decisions, halt and request confirmation from the owner. If requirements and tokens are already fully defined, proceed directly to Phase 2.

---

## Phase 2: Surgical Implementation

1. **Reuse Existing Primitives**: Never invent new button or control classes. Reuse existing classes documented in [references/controls-guide.md](references/controls-guide.md).
2. **Preserve Load-Bearing Rules**: Never remove or rewrite CSS rules or markup containing rationale comments (dates, D-numbers, sizers, specificity bumps).
3. **No Layout Shift**: Ensure labels on dynamic buttons or chips use fixed-width sizer copies or stable gutters so text does not shake.
4. **Regular Headings**: Heading elements and button labels stay regular weight (400 or 500); never bold.

---

## Phase 3: Multi-Layer Verification & Review

Before declaring the feature complete, execute all required checks in sequence:

1. **Design Token Integrity**:
   Run `npm run design-check` to verify zero token drift, no raw hex colors, and 8pt grid compliance.
2. **Repository Gate**:
   Run `npm run gate -- --build` to verify TypeScript, Astro diagnostics, Biome linting, unit tests, docs budgets, and static build in parallel.
3. **Browser Suites (for UI Changes)**:
   Run `npm run e2e -w @singularity/web` and `npm run e2e:player -w @singularity/web`.
4. **CodeRabbit Second Opinion**:
   Run `coderabbit review --agent` (via `code-review-rabbit` skill) on the diff to catch edge cases, concurrency regressions, and accessibility flaws.
5. **2-Minute Test Close**:
   Report visible proof of the verified states and close with one concrete, 2-minute verification action on localhost (e.g. `http://localhost:4321/...`).

