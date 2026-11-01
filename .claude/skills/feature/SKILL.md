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

Pick every control and token with `npm run ds -- find "<need>"`: the part, when to use it, what to use instead, its markup and tokens. `tokens/llms.txt` is the one-page index; [references/controls-guide.md](references/controls-guide.md) has the markup contracts (section 2) and the universal rules (section 4). Neither repeats the other, so they cannot drift. Never invent bespoke control classes: a new one needs an entry in `BESPOKE_CONTROLS` in `apps/web/src/styles/styles.test.ts` with an owner-approved reason; a part that does not exist yet is a question for the owner, and a new part is added in `scripts/system/parts.ts` in the same change.

For any transition, animation or gesture-driven movement, follow [the motion skill](../motion/SKILL.md) and [docs/specs/motion.md](../../../docs/specs/motion.md).

### 4. Design System & Budget Contract

- Identify exact semantic tokens to be used (`npm run ds -- token <words>`; the color roles are in `tokens/llms.txt`).
- Verify 8pt spatial grid compliance (4px only for designated micro-alignments).
- **Phone-First Rule**: On viewports under 40rem, menus and selects open as bottom sheets, not popovers (D167, Ledger section 11).
- **First-Load JS Ceiling**: Keep first-load script strictly under the 130 KB gzipped ceiling (`FIRST_LOAD_BUDGET_BYTES`, D141). React islands wake on interaction via `client:wake` (D178).

> **Approval Gate**: If the feature introduces unresolved visual, layout, or product decisions, halt and request confirmation from the owner. If requirements and tokens are already fully defined, proceed directly to Phase 2.

---

## Phase 2: Surgical Implementation

1. **Reuse Existing Primitives**: Never invent new button or control classes. Reuse the parts `npm run ds -- list` shows. When asked to fix a component, change the component first (its class, variant or token, in the rolling `design-system` PR, D254), never a page override; a page patch needs its reason in the PR body (D237).
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
   `npm run blast-radius` lists the surfaces your diff touches and the suites they imply (advisory; it never blocks). Run `npm run e2e -w @singularity/web` and `npm run e2e:player -w @singularity/web` (about 6 minutes each) once, before the PR. Set `PORT` above 4400; never stop or reuse the owner's dev server on port 4321. Tests run on the phone first. In the main suite, tag `@desktop` for a desktop-only test and `@both` for one that must run at both sizes. In the player suite, tag `@wide` for desktop-only and `@desktop` for both sizes; `@both` is not recognized there and runs on the phone only.
4. **Visual Inspection**:
   Screenshot every touched page and every open state (sheet, menu, popover, focused field) at 390x844 and 1526x782, in light and dark, and look at each one. Then run the `design-audit` agent on the diff before the PR.
5. **Code Review**:
   Pick the tier ([code review](../../../docs/engineering/code-review.md), D292). Tier 2 and a diff you expect to come back: `cr review --base main --committed --deep` before the push; fix or answer its findings. Other tiers go straight to the PR review. When the PR is ready, post `@coderabbitai review` for its one PR review (a draft marked ready starts none); Tier 2 asks again after the fixes. Fix or answer every finding, then merge by hand (D143, D192).
6. **Scope & Record**:
   `git diff --stat origin/main` must list only files the task needs; name every shared stylesheet or component in the PR body, and why. A component change lands in its shared class, with its record in the same PR: the usage comment over the class, a line in the touched surface's file under [docs/ledger/](../../../docs/ledger/README.md), a new variant in [look-and-sound](../../../docs/specs/look-and-sound.md). Update [docs/state.md](../../../docs/state.md) and, for a change of direction, [docs/decisions/](../../../docs/decisions/README.md) (next free D-number: check open PRs first).
7. **Two-minute test**:
   Close with one concrete action the owner can take on localhost (for example `http://localhost:4321/...`) to see it work.
