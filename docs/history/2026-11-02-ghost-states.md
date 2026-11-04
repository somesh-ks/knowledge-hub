# Ghost control states (D317 step 2, D321)

D317 made a filled control's hover and press an explicit OKLCH step of its fill. A control with no fill had nothing to step, so 62 rules still laid the label colour at 8% or 12% over whatever lay behind. #582 gave each container a pair, `--ghost-hover` and `--ghost-pressed`, that steps the surface the control sits on: the page's by default in `foundations.css`, and raised, overlay, inverse, container, the dock and the sheet set their own next to `--color-focus-gap`. `styles.test.ts` fails a rule that records a surface behind its controls without setting the pair, and fails any hover or press mix outside `ripple.css` and `library.css`.

What it kept alpha, and why (D321): the tap ripple and a cover's press lie over artwork, where there is no one fill to step from.

What review found, which the sweep alone did not:

- The library view toggle and search clear had a hover but no press at all; a still of rest, hover and press showed the two frames equal. Press rules now come after the hover rule at the same weight.
- A pressed bar's `::after` fill was an alpha before, so it showed the title through it. An opaque fill covered the dock's title and artwork until it went behind them (`--z-beneath`).
- The accent tint (L 98 in light) cannot step a whole press: the settled direction was lighter, it clamped at white, and hover equalled press. Its two states take the quiet and the hover step and carry no label.
- The toast's Undo is the accent on the inverse surface; the plain inverse press gave 4.0:1. Its fills are their own tokens, `surface-inverse-action-hover` and `-pressed`, settled against the accent label.
- A card chip's hover rule came later at the same weight as its press, so a held mouse stayed on the hover tone.

The Create form's voice picker is an outlined field and changes only its border; the owner kept it that way because it matches the field pattern.
