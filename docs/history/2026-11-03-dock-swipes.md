# Dock swipes: quiet, and a visible target (2026-11-03)

D359. Somesh: swiping the player dock up and down played the open and close sounds, and a sideways swipe gave no hint of the podcast it would switch to.

Sounds. The surface controller now says how a commit was decided (`drag` or `command`); a drag is felt through its haptic and not heard. A sheet pulled down (`pullDismiss.ts`) or swiped away (Base UI's `swipe` reason, `SheetFrame.tsx`) calls `quietNextClose()` (`sound/gestureQuiet.ts`), and the close cue that follows takes the note once. Not changed: the scrub detent while dragging the seek line (a drag over items, D273); a tap, a key and a button keep their cues. A browser test counts oscillators across a tap, an up swipe and a down swipe, and failed with the old code.

Peek. `useDockSwipe` draws the neighbour (cover, title, kind) as `.dock-peek`, one bar's width off the side and moving with the finger; the bar clips to its own box. Past the swipe rule both slide on over 250 ms, the podcast is asked for at once, and the slide is dropped when the player shows it, never before the slide has landed. Once the finger is sideways the surface controller's gesture ends, so a wander up never pulls the page.

Gotchas: a grid item placed on cells the thumb and words used to auto-place pushed them to a second row, so they are placed now; the peek uses `contain: size` so a long title cannot widen the wide bar.
