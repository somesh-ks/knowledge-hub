# Sound and accessibility as design

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## Sound
- **Engine.**
  - Fourteen procedural recipes from one wooden-bar voice in D major pentatonic.
  - Peaks at most -13 dBFS; four voices at most.
  - Direction carries meaning: up is forward, on and open.
  - Narration is sacred: cues are skipped or ducked while it plays (D18, `design/sound-design.md`).
- **Wiring.**
  - Every enabled control sounds by kind (navigate, select, tap, open and close): "the interface sounds don't really work on everything" (2026-10-12).
  - One delegated listener picks the cue by role or `data-sound`, rate-limited to one per 90 ms (`uiClicks.ts:27`, `:45`), so new UI sounds right without wiring. A `menuitem` is a tap, not a toggle.
  - Dialogs sound on open and close through a MutationObserver on `open`, which also catches Escape and the scrim (`uiClicks.ts:140`).
  - Hover, focus, scroll and typing are silent.
  - A save that went through is silent (D101).
  - The first press froze 285 ms, 221 ms of it `new AudioContext()`. The context is now made on the first `pointerdown` or `keydown`, and the first cue is queued (`soundController.ts:81`, 2026-10-09).
  - On iOS `pointerdown` is not an activation for audio, so the unlock also listens to `pointerup`, `touchend` and `click` (`packages/sound/src/engine.ts:373`), and sets `audioSession.type = "playback"` (D105).
  - Sound belonged in the first brief: "design a high quality ui, interactions, and also integrate good ui sounds" (2026-10-05).


## Accessibility as design
- **Targets.** 44px on every visible control on every route, tested; 36px faces get a pseudo-element target.
- **Focus rings.**
  - A 2px outline with a gap in the local surface colour; outlines rather than shadows, so forced colours keep them.
  - Ring shapes follow the visual (tile, pill, thumb).
  - Pointer users see no ring on programmatic focus.
- **Keyboard and screen readers.**
  - The transcript and the Stories list are each one Tab stop.
  - Tab follows the visual order: fix the DOM order first; `reading-flow` is Chromium only.
  - One live region speaks each message (D90).
  - Focus never drops to `body`: after a dismiss it goes to Create, after Retry to the bar's own button (2026-10-08, 2026-10-09).
  - The hero cover's play is pointer-only, so a keyboard meets one Play, not two (2026-10-08).
- **User preferences.** `prefers-contrast: more` strengthens hairlines; `prefers-reduced-transparency` makes the scrim opaque.
