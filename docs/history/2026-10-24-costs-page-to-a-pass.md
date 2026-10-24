# The Costs page, to a design audit's pass

2026-10-24. The owner's goal: iterate until the Costs page makes natural sense, follows the design system and the design-engineering rules, and has a good visual balance. Several audit rounds, the owner's reports between them, and three workers on the asks that came in alongside.

## What the owner asked

- The Costs page checked against the design system after its last change, not on the strength of earlier screenshots.
- Mid-way: "the graph, table switcher is broken"; a rule that a component changed is changed in the design system; fix the design-system warden's findings; the card rows' inset at 4px with roomier targets; Sources' heading, search field and row tiles aligned; the emoji picker's delay, centring and hover.
- Calls on the way: a chip on a card hovers at half the state layer in light; on a phone the chart or table switch sits beside the figure (D177); the table fades its hidden edge; the breakdown reads "Shared or own".

## What landed

- #250: a failed fetch hides the chart, breakdown, table and switch; the shared segmented tab centres a glyph; `--card-chip-hover`; `/analytics` in the page sweeps; AGENTS.md's rule that a component changes in the design system.
- #253: the emoji picker draws in batches with cells rendered on view, preloads on intent, centres the ink and takes the standard hover layer.
- #265: the switch beside the figure on a phone (D177); `.scroll-fade-inline` for the table; the table a tab stop while it overflows, its ring on its parent; `.segmented-nav-compact` with a 44px target; the head keeps its height whatever is chosen; axe and the 44px sweep cover Costs.
- #284: stacked chips sit against the switch from 40rem. #285: card tiles 4px in, Sources tiles on the field's edges. #270: the Windows baseline for the Add source snapshot.
- The final audit at 85252a5b: PASS (axe 0 in 12 states, 44px targets, no shift, tokens only).

## What went wrong

- The first audit agent could take no screenshot under the worktree guard; later ones ran prepared scripts.
- The audits found what the sweeps could not: `/analytics` was in neither the axe routes nor the 44px page list, so a keyboard-unreachable table and 36px tabs went unseen.
- Decision numbers collided again (D176 with #254); `main` moved under every PR, and its settings spec once sat 12 bytes over budget, failing every PR's docs check.
- A layout test's invented $97.70 read as real spend in a screenshot; real spend was $2.95 over 13 runs.
- #265 merged while its browser job ran: GitHub reports no rules on `main`, so nothing waits for CI.

## Not done

- A real phone and VoiceOver or TalkBack on Costs; the emoji picker live (production has no custom topic page to open it from).
