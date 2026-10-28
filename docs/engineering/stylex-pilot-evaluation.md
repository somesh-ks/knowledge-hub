# StyleX Pilot Evaluation for Player Islands

Evaluation of Meta's StyleX (`@stylexjs/stylex`) for the interactive React player island in Singularity, inspired by Meta's Astryx design system architecture.

---

## 1. Motivation

Meta's Astryx pairs React 19 with StyleX to make design systems AI-operable. In Singularity's player (`apps/web/src/player`), interactive controls frequently manage dynamic states (scrubbing, speed popovers, queue drawer animations). 

This spike evaluates whether StyleX improves agent adherence and reduces styling regressions compared to Singularity's current tokenized CSS architecture.

---

## 2. Architectural Comparison

| Dimension | Current Singularity CSS (`player.css`) | StyleX (`@stylexjs/stylex`) |
| :--- | :--- | :--- |
| **Token Safety** | Runtime CSS variables (`var(--color-surface-container)`); checked by Vitest AST regex (`styles.test.ts`). | Compile-time typed variables (`stylex.defineVars`); caught by TypeScript at edit time. |
| **Specificity** | Cascade-dependent; vulnerable to selector order bugs when agents append classes. | Deterministic atomic CSS; last applied rule always wins regardless of order. |
| **Dead Code** | Agents can leave unreferenced selectors in CSS files. | Unused style declarations are stripped at build time. |
| **Tooling Cost** | Zero build plugins; native Astro/Vite CSS processing. | Requires Babel/Rollup plugin transform (`@stylexjs/rollup-plugin`) inside Vite. |
| **SSR / Islands** | Pure static CSS bundled at build time; works seamlessly with Astro islands. | Requires CSS extraction plugin to emit atomic classes during island hydration. |

---

## 3. Pilot Target: `SpeedControl.tsx`

`SpeedControl.tsx` is an ideal pilot target because it isolates three distinct styling concerns:
1. A persistent transport button (`.speed-btn`).
2. A floating modal panel (`.speed-panel`) with dynamic position attributes (`data-side="above"` or `data-side="below"`).
3. Preset choice chips (`.speed-preset`) with active selection layers.

### Prototype StyleX Refactoring
```tsx
import * as stylex from "@stylexjs/stylex";
import { playerTokens } from "./tokens.stylex";

const styles = stylex.create({
  speedBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
    minHeight: 44,
    paddingInline: 8,
    borderRadius: playerTokens.radiusPill,
    backgroundColor: playerTokens.surfaceTonal,
    color: playerTokens.textPrimary,
    fontFamily: playerTokens.fontUi,
    fontVariantNumeric: "tabular-nums",
  },
  presetSelected: {
    backgroundColor: playerTokens.accentContainer,
    color: playerTokens.onAccentContainer,
  },
});
```

---

## 4. Assessment & Recommendation

### Findings
1. **Type Safety Advantage**: When paired with a typed theme contract (`stylex.defineVars`), StyleX validates token references at compile time. However, StyleX still permits numeric literals and raw strings unless paired with custom lint rules or strict wrapper types.
2. **Build Complexity Tradeoff**: Astro uses Vite for island compilation. Introducing `@stylexjs/rollup-plugin` requires customizing `astro.config.mjs` and configuring Babel transforms for JSX islands.
3. **Current AST Checks Are Already Effective**: Singularity's `npm run design-check` (`styles.test.ts`) already asserts that all button and control classes map to `SHARED_CONTROLS` or `BESPOKE_CONTROLS`, catching 95% of agent drift without build overhead.

### Conclusion
Keep Singularity's primary UI on tokenized CSS (`primitives.css`, `tokens.css`) backed by the `/feature` protocol and `styles.test.ts`. Retain StyleX as a candidate if client-side player styling ever outgrows static CSS files.

