---
name: motion
description: "Add or change motion in Singularity: pick the duration and easing from the tokens (spatial vs effects springs, press, enter, sheet), keep reduced motion, and check it ran. Use for any transition, animation, spring, morph, loader or gesture-driven movement, or when the user says motion, animate, spring or Expressive."
---

# Motion

The rules are in [docs/specs/motion.md](../../../docs/specs/motion.md); this skill is the order to apply them in. It does not repeat the token table, so the two cannot drift. The design site's Motion page runs every token live.

## Steps

1. **Ask if it should move.** Read the one rule in the spec. If the reader did not move it and it tells them nothing, do not animate it. State the reason in one line before writing CSS.
2. **Pick tokens, not values.** Follow "Choosing a token" in the spec: effects spring for fades and colour, spatial spring for travel and reshape, `--duration-press-*` and `--duration-hover` for presses, sheet and drawer tokens for sheets. A literal duration, a private easing, `transition: all` or a raw length fails `styles.test.ts`.
3. **Default to Calm.** Take the 1.5% spatial springs (default, slow). Use the fast, 9.5% spring only where a finger is on the thing.
4. **Animate cheap properties.** `transform`, `opacity`, `clip-path`. A control holds one box across its states; a hidden copy holds the room when content swaps.
5. **Write the reduced-motion path in the same edit.** Travel collapses, fades keep their time, loops hold one shape and pulse. A raw-value move needs its own `prefers-reduced-motion` rule.
6. **Check it ran.** `npm run design-check`; then in a browser, `document.getAnimations()` on the open state, once normally and once under emulated reduced motion. For an owner-reported "it moves or jumps" fix, add the one browser assertion from AGENTS.md (the box holds still, compared to itself).

## Shared components

A hero moment (Play morph, wavy progress, morphing loader) or any change to a shared component goes through the design-system track: its own PR with the `design-system` label, which the owner merges by hand. A feature PR does not change a shared component's motion. Show a labelled Proposed demo on the design site first; the owner picks what ships.

## Outside the repo

The generic animation skills (`animate`, `emil-design-eng`) explain craft in general. Where they disagree with the spec or the tokens, the spec wins: durations at most 300 ms except the drawer and the spring tokens, no plain ease-in, reduced motion is fewer and gentler, never none.
