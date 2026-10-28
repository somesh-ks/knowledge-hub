# Feature Brief: [Feature Name]

Date: [YYYY-MM-DD]
Status: Draft | Approved
Owner Review: Pending | Signed Off

---

## 1. Intent and User Journey

- **User Problem**: [What specific user friction or scenario this solves]
- **Primary Flow**: [Step-by-step user path from trigger to resolution]
- **Success Criteria**: [Exact observable outcome and behavior when complete]
- **Reference Product**: [Name the reference product being matched, e.g. Google Podcasts, YouTube Music, Material 3]

---

## 2. 7-State Audit Matrix

Every canonical state must be addressed. Any non-applicable state requires an explicit one-line rationale.

| State | Visual Treatment & Behavior | Implementation / Class | Rationale if N/A |
| :--- | :--- | :--- | :--- |
| **1. Idle** | Resting appearance, default content and labels | Default control class | |
| **2. Loading / Skeleton** | Stable layout placeholder; no layout shift | Skeleton sizer / pulse | |
| **3. Active / Focused** | Pressed, toggled, or playing state layer | State layer / `:active` | |
| **4. Empty** | Contextual empty art, headline, and single CTA | Empty state container | |
| **5. Error / Retry** | Inline message with clear recovery action | Error text + retry trigger | |
| **6. Disabled** | Dimmed tonal surface (`data-quiet`), unclickable | Disabled attribute in DOM | |
| **7. Offline** | Cached fallback or offline status badge | Storage fallback | |

---

## 3. Design System Contract

- **Control Archetype**: [Selected from canonical archetypes: primary, secondary, tonal, icon button, action chip, filter chip, segmented nav, segmented choice, row action, bottom sheet, floating action]
- **Viewport Adaptivity**: [Desktop popover vs phone bottom sheet under 40rem]
- **Semantic Tokens**:
  - Surface: `var(--color-surface-*)`
  - Text/Ink: `var(--color-text-*)`
  - Spacing: 8pt spatial grid (`var(--space-*)`; 4px micro-alignments only where named)
  - Radius: `var(--radius-*)`
- **Optical Invariants**:
  - Labels regular weight (400 or 500); never bold.
  - No text scaling on press (fill or tonal overlay only).
  - Layout stability (fixed-width sizers for changing text; checks take no room).

---

## 4. Performance & Verification Gate

- **First-Load JS Impact**: [Verify 0 KB added to first load or island hydrated via `client:wake`]
- **Token Check**: `npm run design-check`
- **Gate**: `npm run gate -- --build`
- **Screenshots**: Light and dark at 390x844 (phone) and 1526x782 (desktop), capturing open states

