# 2026-10-29: the style guide as its own app

The owner opened `/design`, found it missing on production, and asked for the admin pages and the design catalogue to leave the reader: a command center at `/admin`, a style guide at `/design`, both in the app's own language (the first attempt looked like another product). This note is the style guide's half (D222); the command center is its own thread (PR #421).

## What was built, and what was cut

- `apps/design`, a static Astro app with base `/design`, importing the reader's stylesheets, shell and nav classes by relative path, as `apps/admin` does.
- Pages from the old catalogue's content: colour (the live value and WCAG ratio of thirteen pairs, measured through a canvas), type (resolved size, weight and leading, a sample field), tokens (motion tokens run on a press, icons), principles (written from `PRODUCT.md`, the ledger and the decisions; each D-number checked against the Index).
- A first build also had 44 hand-written specs (`*.design.ts`), a component index with cards that stepped through states on hover, and a page per component with live controls. Four workers wrote the specs in parallel from one brief. CodeRabbit found 32 issues in them, nearly all in the copied markup (duplicate ids, labels that did not follow the state, disabled looks the stylesheet lacks). The owner then asked for 100% parity with the real components and true names, and chose to strip the component pages from the pull request. The work is recoverable in the branch history (commit 048c30c).
- After the owner's first look: the wordmark reads "Singularity" with a "Design" chip, there is no link back to the reader, the foot of the side column has the build day and the theme choice.

## Why the specs went

They were a copy, so the guide could show a part the app no longer draws, and the test could only see a missing entry, not a stale one. The reader has no component library: it has about 25 button and link classes that are about 7 components (a text button written six ways, four icon buttons, three FABs). A guide that mirrors the app must come after the components are merged and named; the plan is in [state.md](../state.md) item 6.

## Left for later

- The reader's own `/design` page stays until the rewrite is live.
- Not seen: Safari and WebKit, a real phone, a keyboard-only pass of the controls.
- The owner's asks not yet built: an accordion side menu for sub-sections, the filters as chips with a drop-down, per-component coverage and light analytics (with how they are measured documented), a theming engine driven by a few variables, expressive parts, better icons, and a deeper look at how Material 3's documentation site is organised.
