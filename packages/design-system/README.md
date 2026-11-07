# @singularityfm/design-system

The components, stylesheets, tokens, fonts and flags that the Singularity reader is drawn with. It ships
Astro source (`.astro` and `.ts`), not compiled output: your Astro build compiles it.

## Install

```sh
pnpm add @singularityfm/design-system
```

Peer dependency: `astro` (^7.4.4). Node 24 or later.

## Imports

```astro
---
import Button from "@singularityfm/design-system/Button.astro";
import { buttonClass } from "@singularityfm/design-system/button";
import "@singularityfm/design-system/styles/tokens.css";
import "@singularityfm/design-system/styles/buttons.css";
import tokens from "@singularityfm/design-system/tokens/tokens.json";
---
```

| Path | Resolves to |
| --- | --- |
| `<Name>.astro` | a component in `src/` |
| `<module>` | a helper in `src/<module>.ts` |
| `styles/*` | a stylesheet; `tokens.css` defines the custom properties the others read |
| `tokens/*` | the token, glyph, cover and system JSON, and `llms.txt` |
| `fonts/*`, `flags/*` | font files (`styles/fonts.css` loads them) and one SVG per country |
| `scripts/themeInit.js` | the head script that sets the theme before first paint |
| `scripts/*` | the token generator and colour helpers (TypeScript) |

CSS files have side effects; everything else can be tree-shaken.

## Versions

Semantic versioning, released with Changesets: weekly, or on demand, and never when no change is pending.
[COMPATIBILITY.md](./COMPATIBILITY.md) says what counts as breaking and how a deprecation runs. Pin an exact
version in an app and take bumps as pull requests. Canary builds (`0.0.0-canary-<sha>`, dist-tag `canary`)
exist only for a library pull request labelled `canary`.

## Licence

MIT (LICENSE). The fonts (SIL OFL 1.1), the flags (Flagpack, MIT) and the icon paths (Phosphor, MIT) keep
their own licences, listed at the end of LICENSE.
