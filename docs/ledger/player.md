# The player

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## The player
- **One surface, not a modal drawer** (D32).
  - One `--p` scalar, a registered `@property`, drives travel, the dock fade, the nav slide and the cover morph.
  - A JS spring integrator carries the release velocity, so a tap, a key, a pull or a flick can interrupt any other.
  - Thresholds: a flick down above 0.5 px/ms closes, a flick up above 0.4 px/ms opens; 35% of the distance closes, 25% opens.
  - 12px slop, and the drag is anchored at the edge of the slop so nothing jumps.
- **Cover morph.**
  - FLIP from the bar into the page below 64rem only; on desktop the cover does not fly (owner, 2026-10-08 and 2026-10-11).
  - The corner radius divides by the live scale, so corners match at every point.
- **Open page.**
  - No header (D50).
  - Speed between the skips, on a slider from 0.5 to 2x in 0.05 steps (D50, D101).
  - Stories and Transcript (D101).
  - One left edge (D90).
  - No handle, square top corners throughout (D111).
  - On a wide screen with a mouse, the bar keeps previous, play, next and the clock (D101): details on the left, transport centred, volume on the right (2026-10-13); the mute button holds the right edge and the level opens to its left (2026-10-18). "In mobile, it's a different behavior, so you need to be mindful" (2026-10-12).
  - Previous shows only on wide screens; the phone bar never carries it (2026-10-08).
  - The bar's controls centre on what shows of the bar, below the progress line over its top edge: centred on the box they read 1px high (2026-10-27). Open: on a wide touch screen with a home indicator the bar grows by the safe area and the controls stay above it, unverified on a device.
  - One transport on screen at a time (D92), and one timeline: the page's own scrubber "duplicates the bar's timeline" and went (2026-10-09).
  - Speed sits between the skips in the DOM, not by CSS `order`, so Tab follows the drawn order in every browser (`TransportControls.tsx:67`).
  - The volume slider's room is reserved; it rests at opacity 0 but stays reachable by Tab, shows on hover, `:focus-visible` or drag, and lingers 400 ms (D106, `player.css:1245-1274`).
- **Audio that survives navigation.** One module-scope audio element, since module scripts run once under the client router (2026-10-05). The service worker never caches audio, because Range requests make cached media unreliable (`sw.js:337`).
- **Transcript.**
  - Said words in full ink, the spoken word on a soft fill that appears at once, read 90 ms ahead (D105).
  - The highlight pauses through unseen lead-in words (D107): `lead_words` per story (`lib/digests.ts:81`) shifts the marks, so nothing lights until the next story's first word.
  - It follows only once the listener scrolls it into view, with "Back to now" (D94). Centring the current turn on mount had scrolled a phone page 388px past the cover.
  - It is one Tab stop (D90).
  - Below 64rem the Stories and Transcript switch is sticky on the surface colour with the safe-top inset, the gap as padding so text never shows through (`player.css:2036`).
  - Hosts carry colours in the script view: Ada the accent, Leo the warning hue (2026-10-08).
- **Scrubber.**
  - A 44px row; the track scales 2x while dragging; the thumb pops on the pop spring.
  - The time bubble sits on a hidden widest-time copy and snaps to device pixels.
  - Chapter gaps are masked into the track.
  - One soft sound per story crossed, with 2% hysteresis.
- **Errors.** Told once, in the story line's room, with a refresh glyph on the disc. A glyph always says what a press does (D92, D94, D98).
- **Lean page (2026-10-25).** No transcript and no queue: the list is hidden and the cover and controls take one centred column from 64rem (`.player-page-inner[data-lean]`); a transcript or a queued item brings the list back. The cover keeps its row and size, and on a phone its place; side by side it moves to the left column.
- **Queue and Up next.** A chevron top left below 64rem shows how to close; a peek strip "Up next" pulls up into a queue sheet with a docked now-playing row; after the end only Up next shows. Drag and pull gestures are untested on a real phone (2026-10-21, D126). The ended view had kept the Stories tab (audit, 2026-10-22): the tab line now holds Up next alone, so nothing under it moves and a focused tab keeps focus, until the recording plays again; an ended player with Autoplay off shows Suggested (`accessibility.spec.ts`).
- **Expand chevron and speed offer (2026-10-25).** D102 holds on the phone bar (no chevron) and for the keyboard-focus chevron on the open desktop player (D126); from 64rem the dock also holds a visible control (D193): a chevron `.icon-btn` right of volume (`.dock-expand`, PlayerBar.tsx): up while the player is collapsed, down when open, turning in `--duration-state` (not under reduced motion), `aria-expanded` and "Expand player" or "Collapse player". A speed chosen in the player lasts one episode (an episode counts at the speed it was left at); the next starts at Preferences, Default playback speed. After the same speed in three episodes, or an episode ending off the default, the shared confirm dialog asks "Make 1.5x your default speed?" once per speed (`SpeedOffer.tsx`, `core/speedDefault.ts`). Browser specs for both are unrun (no browser binary in the first pass).
