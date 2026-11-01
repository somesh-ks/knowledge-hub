# Motion and navigation

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## Motion and navigation
- **Navigation feel.**
  - The ask: "there is a delay in switching between different nav menu pages, I want the app to be snappy, performant" (2026-10-08).
  - A move between pages took 400 ms, mostly an accidental default crossfade. It is now answered from a saved copy: 2 ms for the page, 32 ms to the new page on screen, 132 ms fully drawn (D47).
  - Why the crossfade ran: Astro's swap keeps only a fixed set of root attributes, so `data-astro-nav` was dropped and the 330 ms default played. `navigation.ts:77` carries it onto `event.newDocument` in `astro:before-swap`.
  - The incoming page fades up in 100 ms, with an 8px settle into or out of a briefing.
  - `navigationBoost.ts` replaces the view-transition snapshot with an immediate swap: a one-shot stand-in for `document.startViewTransition`, branded with a WeakSet, that marks the new document `data-nav-swap` (`:66`, `:118`, `:138`). It skips two frames of snapshot capture.
  - The service worker answers a move from a stamped copy (`x-singularity-stored-at`): fresh for 10 minutes, rechecked in the background after 15 s, expired when `/latest.json` changes (`sw.js:28-32`). A stale tab reloads itself after a deploy, never while offline, playing, typing or with a sheet or Undo open (D202, 2026-10-27).
  - A touch `pointerdown` starts the fetch about 100 ms before the tap ends.
  - The pressed nav item lights up before the page arrives.
- **Motion rules in tokens.**
  - Press in 100 ms, out 160 ms (in faster than out, tested).
  - Durations at most 300 ms, except the 500 ms drawer; a spring is measured by its token's `perceptualMs`, not its settle time.
  - No plain ease-in (tested).
  - Three `linear()` springs: settle (no overshoot), release (1.0062 peak), pop (1.0284 peak).
  - Press scale 0.97, enter 0.96.
- **Reduced motion.**
  - Travel collapses: the distances to 0px, the enter scale to 1, the sheet and spring durations to 0.01 ms. Enter, exit and stagger keep their time, so every fade stays; a move written as a raw value gets a reduced-motion rule of its own (DD-003, 2026-10-23, `reducedMotion.spec.ts`).
  - The player becomes a fade, the spinner pulses, the floating button stays extended and the app bar never hides.
- **Micro-motion.**
  - Play and pause swap at 0.95 scale with a 3px blur.
  - A filter chip's check scales in while its label slides 8px.
  - A switch thumb stretches while pressed.
  - The tab underline grows from 0.4.
  - The app bar's hairline is scroll-driven.
  - Tabs and lists fade at their edges with scroll timelines (`@property` masks).
- **Scroll chrome.**
  - The app bar hides on scroll down and becomes `inert` while hidden.
  - A tab jump puts the bar away first and holds it until `scrollend` (D93).
  - Pressing the current tab scrolls to the top (D52).
- **Press ripple (D286).**
  - A large touch target shows its touch area as a wave from the finger: 300 ms on the hover curve, fading after the lift (a quick tap lets it play half its growth first).
  - The press state starts on the first touch (`data-ripple-pressed`), not on `:active`.
  - The wave carries across a page move on the animation clock.
