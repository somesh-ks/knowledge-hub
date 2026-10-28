---
name: feature
description: "Build and share production-grade features in Singularity: enforces a 1-page contextual feature brief, 7-state audit (with explicit N/A justification), canonical control archetypes, and multi-layer verification (design-check, gate and bundle budget, browser suites, screenshots, design-audit, and code review). Use when asked to build a new feature, add interactive UI, modify user flows, or when the user invokes /feature."
---

# Feature Development Protocol

Builds fully baked, production-grade features for Singularity. Enforces upfront clarity, strict design system compliance, budget preservation, and multi-layer verification before declaring completion.

## Step 0: Early Status & Delta Check

Before starting work or modifying files, run a lightweight status check:
```bash
python .claude/skills/feature/scripts/verify_feature.py --status
```
The script lists any modified or untracked files. If any of them belong to another task or are uncommitted work in progress, stop immediately and ask for guidance before proceeding.

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

### 3. Canonical Control Archetypes

Pick every control from the decision matrix in [references/controls-guide.md](references/controls-guide.md) (sections 1 and 4: the matrix and the universal rules; open the markup contracts for the control you use). That file is the one copy of the matrix; this skill does not repeat it, so the two cannot drift. Never invent bespoke control classes: a new one needs an entry in `BESPOKE_CONTROLS` in `apps/web/src/styles/styles.test.ts` with an owner-approved reason.

### 4. Design System & Budget Contract

- Identify exact semantic tokens to be used (`--color-surface-*`, `--color-on-surface-*`, `--color-accent-*`, `--space-*`, `--radius-*`; the names are in `apps/web/src/styles/tokens.css`).
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

Run commands through PowerShell on the owner's machine ([AGENTS.md](../../../AGENTS.md)). Before declaring the feature complete, execute all required checks in sequence:

1. **Preflight**:
   Run `python .claude/skills/feature/scripts/verify_feature.py --check` for em dashes in the changed files and `npm run design-check`, which holds the colour-token, grid and control rules.
2. **Repository Gate & Build**:
   Run `npm run gate -- --build` (typecheck, `astro check`, Biome, unit tests, docs budgets and the static build). The build's `postbuild` step runs `checkBundle.ts`, which enforces the 130 KB first-load budget against that build; there is no separate bundle command to run.
3. **Browser Suites (for UI changes)**:
   Run `npm run e2e -w @singularity/web` and `npm run e2e:player -w @singularity/web` (about 6 minutes each) once, before the PR. Set `PORT` above 4400; never stop or reuse the owner's dev server on port 4321. Tests run on the phone first. In the main suite, tag `@desktop` for a desktop-only test and `@both` for one that must run at both sizes. In the player suite, tag `@wide` for desktop-only and `@desktop` for both sizes; `@both` is not recognized there and runs on the phone only.
4. **Visual Inspection**:
   Screenshot every touched page and every open state (sheet, menu, popover, focused field) at 390x844 and 1526x782, in light and dark, and look at each one. Then run the `design-audit` agent on the diff before the PR.
5. **Code Review**:
   Run `/code-review` first for a large change. CodeRabbit reviews the PR on GitHub; fix its findings, then merge by hand (D143, D192).
6. **Scope & Record**:
   `git diff --stat origin/main` must list only files the task needs; name every shared stylesheet or component in the PR body, and why. A component change lands in its shared class, with its record in the same PR: the usage comment over the class, a line in [the ledger](../../../docs/design-engineering-ledger.md), a new variant in [look-and-sound](../../../docs/specs/look-and-sound.md). Update [docs/state.md](../../../docs/state.md) and, for a change of direction, [docs/decisions.md](../../../docs/decisions.md) (next free D-number: check open PRs first).
7. **Two-minute test**:
   Close with one concrete action the owner can take on localhost (for example `http://localhost:4321/...`) to see it work.
