# Design engineering ledger

Every design-engineering tweak and visual change asked for on this project, what was built, what the code does as a result, where it falls short, and what could come next. Written 2026-10-14.

Sources:
- `decisions.md` D1 to D115.
- The 23 notes in `history/`.
- `design-engineering-audit.md`, `design-systems-audit.md`, `design/design-spec.md`, `design/sound-design.md` and `vision.md`.
- `learnings.md`.
- The cloud session of 2026-10-14.
- A read of `apps/web/src` and `tokens/`.

Chats older than that session survive only as the decisions and notes they produced, so they are covered as recorded there. Each fact links to its decision rather than restating it; if this file and a decision disagree, the decision wins.

## 1. What the owner wants, in one page

Patterns from about 150 asks, strongest first.

1. **A real app, not a generated page.** The owner called boxed outlines "ai slop" twice (D72, D76) and keeps naming references to copy rather than invent:
   - Google Podcasts and YouTube Music for the whole app (D31).
   - Material 3 tonal surfaces (D72).
   - Anthropic's model list for every dropdown (D51).
   - Speechify for the transcript (D50).
   - Android's rule for the floating button (D52).
   - Native app behaviour for the bottom stack (#120).
   
   Read a new ask as "how does the reference product do this", not "what would look nice".
2. **Nothing moves that the owner did not move.** Several asks are the same complaint:
   - Scrub times that shake (2026-10-11).
   - A chip that grows as its check appears (D95, #116).
   - A panel that shakes when More options opens (D102).
   - A page that scrolls itself at each turn (D94).
   - The bottom stack drifting apart (#120).
   
   The code answers with fixed-width chips, hidden sizer copies, `scrollbar-gutter: stable` and checks that take no room. Treat any layout shift as a bug.
3. **Live and quiet.** No waiting copy, no chatter about saving:
   - "Live curated" removed (D75).
   - The age banner removed (2026-10-11).
   - The "Next episode" line removed (D102).
   - The Saving and Saved toast removed, "I want it to feel live and natural" (D115).
   - Labels not bold, "captures too much attention" (#125).
   
   The interface says something only when the owner can act.
4. **Speed is a design property.** Navigation in 32 ms (D47), the early Play tap kept (D82), modulepreload and idle loading (D112). "Delays in time to play" is a design complaint here, not an engineering one.
5. **Affordance, not explanation.** The interface shows what a control does by how it looks and answers, never by a sentence telling the owner what to do.
   - The rule from 2026-10-08: "no instruction text that the control makes obvious", from "These minor usability aspects are the differentiating factors" (`history/2026-10-08-session-learnings.md`).
   - D89 records "a control that explains itself is the thing the owner called slop". It rejected a disabled row with a note; D91 rejected a Format row with a note.
   - Fixes that follow the rule:
     - An unlabelled plus "says nothing about what it makes", so the floating button carries its words (D52).
     - The model field reads as a select: a hand cursor, a caret on focus, and a press opens the whole list (D51).
     - A glyph always says what a press does: refresh for Try again, replay for Play again (D92).
     - A card's title takes the accent under a mouse, because the title opens the page and the art plays (D101).
     - The whole bar opens the player, so it needs no chevron (D102).
     - A control that cannot act stays on its row, dimmed and named, never hidden (D100).
     - A decoration must not look pressable: empty scenes stopped drawing a filled disc in the button's colour (D98).
     - A name is plain text and the row opens the editor: one element, one job (D83).
   - States are shown, not narrated:
     - Hover and press are state layers (D72).
     - The chosen item takes the accent container (D72).
     - The saved control is the confirmation (D115).
     - A source row says "Adding", then "Added", in place (D91).
6. **Minimal, with high brevity.** Fewer controls, fewer words, one way to say each thing.
   - Settings: one job per page (D51).
   - A shorter New episode form (D76, D114), and modes retired: "Remove, always Somesh" (D114).
   - Plain labels: Format, Custom, AI Model, Last updated (D83, D102). A model named by its name, never by id (D101).
   - One noun for one thing: the third critic round found "five spellings of one noun" (D89). "Story" everywhere in the player (D90).
   - A failure is told once, in one place (D94). A status line is three or four words: "Episode queued", "Writing your episode" (D84).
   - No hedging helper text, and a plainer About (#68, 2026-10-10).
   - Content is brief too: headlines up to 12 words, summaries of 25 to 80 words (D12, D34). The digest has no emoji, no intro paragraph, no dividers and no sign-off (`vision.md`).
   - One filled action per screen: the hero's Play (D77), an empty state's single button (D96), New episode in its own tone so it never competes with Play (D86).
7. **Every control is complete.** It gets a 44px target (test in `e2e/layout.spec.ts`), a sound (D101), a press state that never shrinks words (D72, `styles.test.ts`) and a focus ring that survives forced colours.
8. **Bans.**
   - From the persona: cream backgrounds, italic accent words, "01/02/03" labels, monospace eyebrows, all-caps labels, gradient washes, grey shadows, terracotta.
   - From the record: a chevron on the bar (D102), a grabber on phone sheets (D106), a drag handle on the player (D111), a Dry tone (D101), the General audience (D114), em dashes (`houseRules.test.ts`).

Repeat asks are the clearest signal of what was not heard the first time:
- Stories and Transcript tabs: "that I have told you multiple times" (D101).
- The time zone, removed in D89 and asked back in D100.
- Format and the second voice, removed in D91 and asked back in D100.

## 2. The ledger, by surface

Ask, then what was built, then the decision. Values are as built.

### Look, tokens and type
- **Look.** Hand-written CSS from DTCG tokens, Base UI for accessible parts; Tailwind and shadcn rejected as a templated look (D4).
  - Pipeline: `tokens/tokens.json` to `scripts/buildTokens.ts` to the generated `styles/tokens.css`.
  - Tests check token drift, tiers and contrast.
- **Tonal language** (D72, owner: "a real Google app"):
  - `surface-container` for the page's own controls.
  - `accent-container` for chosen or current.
  - `accent-container-high` for actions that are not places, such as New episode (D86).
  - State layers: hover 8%, press 12% of the control's ink.
  - Pills for buttons and chips, 12px rows, outlines only on text fields (3:1, D54).
- **Type.**
  - One family: Google Sans Flex variable, latin only, with a metric-matched Arial fallback.
  - Two weights, regular and medium; a test bans a third (D90).
  - Story and summary 16px at every width; headline 18 to 20px; meta 14px; section headings 22px regular; display at most 32px; reading leading 1.55 (D73).
  - A quiet line goes under its title, never above it (D31).
  - `text-wrap: balance` on headings, kept working by `inline-block` rather than `nowrap` (D93).
- **Spacing and shape.**
  - 4px base, nine steps from 0.25 to 6rem, each at least 25% larger than the last (test).
  - Radii xs to sheet, with concentric radii tested (outer = inner + padding).
  - Reading measure 34rem (D86).
  - Every page starts 64px down from 40rem (D102).
  - Pages share one top rhythm to 1px (`e2e/rhythm.spec.ts`).

### Colour, theme and art
- **Colour model.**
  - OKLCH throughout.
  - Accent hue locked to 245 to 270, neutral chroma at most 0.015 (tests).
  - Dark surfaces rise in lightness for elevation.
  - The light page is a cool off-white; sheets are pure white to read as raised.
- **Contrast is enforced in code.**
  - Text 4.5:1 on every surface in both modes.
  - Non-text 3:1.
  - Containers 1.08:1 and 1.2:1 from the page (`buildTokens.test.ts`).
  - Axe runs on every route in both schemes.
- **Theme.**
  - A 512-byte head script applies the stored choice before first paint (D20).
  - The theme change crossfades with a view transition, and `theme-color` metas follow.
- **Ambient light.** The ask was "a clever but mild use of shaders" (D48).
  - A CSS field of the cover's colours, with a 128px WebGL canvas faded over it.
  - 30 fps, off-screen paused; off for reduced motion, data saver and software renderers.
  - Half strength in light mode (D77).
  - A contrast proof runs over every palette.
- **Covers.**
  - Monthly schemes from 2026-10 (D110).
  - Contrast held by `TYPE_CONTRAST` and `FORM_CONTRAST`.
  - The Strata, Orbits and Facets redesign was rejected.
- **Generated topic art** from id and name (D102).
- **Empty states.**
  - The ask was "beautiful empty state illustration with title and an action button", then "keep the illustrations simple" (D96, D98).
  - Each is one flat object of two to four shapes in theme tones, then a 22px title, one line and one filled action.
  - Inline SVG, no script.

### Motion and navigation
- **Navigation feel.**
  - A move between pages took 400 ms, mostly an accidental default crossfade. It is now answered from a saved copy: 2 ms for the page, 32 ms to the new page on screen, 132 ms fully drawn (D47).
  - The incoming page fades up in 100 ms, with an 8px settle into or out of a briefing.
  - `navigationBoost.ts` replaces the view-transition snapshot with an immediate swap.
  - A touch `pointerdown` starts the fetch about 100 ms before the tap ends.
  - The pressed nav item lights up before the page arrives.
- **Motion rules in tokens.**
  - Press in 100 ms, out 160 ms (in faster than out, tested).
  - Durations at most 300 ms, except the 500 ms drawer.
  - No plain ease-in (tested).
  - Three `linear()` springs: settle (no overshoot), release (1.0062 peak), pop (1.0284 peak).
  - Press scale 0.97, enter 0.96.
- **Reduced motion.**
  - Movement tokens collapse to 0.01 ms; press, hover, state and theme keep their timing.
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

### The player
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
  - On a wide screen with a mouse, the bar keeps previous, play, next and the clock (D101).
  - One transport on screen at a time (D92).
  - The volume slider appears on hover and lingers 400 ms (D106).
- **Transcript.**
  - Said words in full ink, the spoken word on a soft fill that appears at once, read 90 ms ahead (D105).
  - The highlight pauses through unseen lead-in words (D107).
  - It follows only once the listener scrolls it into view, with "Back to now" (D94).
  - It is one Tab stop (D90).
- **Scrubber.**
  - A 44px row; the track scales 2x while dragging; the thumb pops on the pop spring.
  - The time bubble sits on a hidden widest-time copy and snaps to device pixels.
  - Chapter gaps are masked into the track.
  - One soft sound per story crossed, with 2% hysteresis.
- **Errors.** Told once, in the story line's room, with a refresh glyph on the disc. A glyph always says what a press does (D92, D94, D98).

### The bottom stack on a phone

The navigation bar, the player bar, the floating button, the run indicator and toasts share the bottom edge below 64rem. Every fix so far, in the order it came:

- **Shape** (D31, D72, D86).
  - A bottom bar below 64rem, a side column from 64rem.
  - Tonal, 4rem tall, with a 64x32 pill behind the current icon.
  - The hairline above it removed.
  - The player bar takes the same `surface-container` fill, with no line between, so the two read as one block in both themes.
- **Current tab.**
  - The current icon is filled and the others outlined, swapped by `aria-current`; the current label takes the full ink (`shell.css:325-370`).
  - Pressing the current tab scrolls to the top, like a native tab bar (D52), and instantly from a keyboard.
  - A press scales only the glyph, never the label.
  - The pressed item lights up before the next page arrives (`navigationBoost.ts`).
- **It stays put** (D52). Hiding the bar on scroll was rejected: Material's navigation bar stays, and the playback controls dock on it.
- **No pull to refresh** (D52). `overscroll-behavior-y: none` is set in CSS (`shell.css:87-91`) because iOS reads it before the first touch. A pull can no longer restart a briefing mid-listen or show a rubber band behind the opaque bars.
- **The old "stuck" player** (2026-10-08). A navigation with the sheet open destroyed its portal while the controller still thought it open. The player became one persisted island with no portal (D32).
- **The pull moves the navigation** (2026-10-11, owner ask).
  - The navigation slides away by `--player-p` as the player rises.
  - It sat a layer under the player (z 20 over 10), so the slide was hidden from the first frame. It now rises above the player while moving and drops back at rest (`shell.css:269-286`).
- **The dock fades with travel.** On a phone it fades by `1 - p/0.3` while riding the page (`player.css:1060-1065`).
- **Floating button** (D52, D59, D60, D77).
  - Create on the Library only. Play on any page with audio, shown only once the hero's Play has scrolled away. Nothing at 64rem and wider.
  - Extended at the top and on scroll up, folded on scroll down.
  - It rides above the navigation, the dock and the run indicator through summed CSS variables, and hides under the open player.
- **Toasts** (2026-10-10 final audit, D90).
  - A toast sits 12px above whichever of the navigation, the dock or the floating button is highest.
  - It had kept the navigation's inset while the player covered it; that is fixed.
  - It lifts over the floating Play only while that button shows.
- **Room under the page.** `scroll-padding-block` counts the bar, the dock and the run indicator, so focus and jumps never land under them (`shell.css:34-57`).
- **Viewport units.**
  - `min-height: 100dvh` follows a collapsing browser toolbar.
  - A launched home-screen app uses `100vh`, because dvh can misreport there before first layout (`shell.css:93-112`).
  - A sticky band keeps the open player clear of the status bar of a home-screen app (D90).
- **iOS 26** clips fixed elements to the inner viewport, so the sheet's backdrop is absolute (`sheets.css:27`). Safe-area insets are mirrored as `--safe-*`, and a window-controls inset covers iPadOS.
- **Native anchoring** (#120, #124).
  - Every element of the stack is held by its bottom edge, and the player box is `100dvh`. The stack now moves with mobile Chrome's address bar in the same frame instead of drifting apart and snapping back.
  - Not verifiable headless; it needs a phone recording.
- **One control, the whole bar** (D102). No chevron; the whole bar opens and closes the player; a keyboard Close exists at every width. The bar's Tab order follows its drawn order (`reading-flow`, D97).

### Small component fixes

The craft that makes components hold still and answer clearly. Each was a reported or measured defect.

- **Nothing changes width or jumps.**
  - The play chip keeps one width (7rem), so the publisher beside it never moves (D92). Played shows Play again only under a mouse, at a held width (D106, #116).
  - A filter chip's and a segment's check takes no room; the label slides by half of it (D95, 2026-10-11).
  - The segmented thumb slides only while used, so a page never opens with motion (`player.css:2254-2304`).
  - The scrub bubble and the bar's times sit over a hidden copy of the widest time and snap to device pixels, so digits do not shimmer (2026-10-11).
  - Toasts have a fixed width on a phone (they jumped from 105 to 358px).
  - A stable scrollbar gutter stopped the New episode panel rewrapping when More options opens (D102).
  - Rows keep one height with or without a search match (D95). The Add panel's switch keeps one height at every width (D89).
- **Fields and selects.**
  - One drawn list for every select (`appearance: base-select`, set once in `primitives.css`).
    - The text is centred with no UA block padding (2026-10-10).
    - The list opens below its field when it fits, and a phone in landscape still shows more than three rows.
  - The same gap between a value and its chevron (`--field-chevron-gap`), and equal padding in multi-line fields (D106).
  - The model field is as wide as its name, so the hover fill hugs the words (D103). A longer name ends in an ellipsis, not half a name (D91).
  - A field grows on focus only with a fine pointer, so it never moves under a tap (2026-10-12).
  - An open list lifts its row above the next one (`.rows > :has([aria-expanded="true"])`, 2026-10-11).
  - A list that fails to load says so inside the open list (2026-10-12).
- **Press, hover and focus.**
  - Words never shrink on press; label controls show a press on their fill (2026-10-10, `styles.test.ts`).
  - Hover layers are the fill's own alpha, so a focus ring is never faded (2026-10-11).
  - A colour transition runs on the hover state only, so a theme switch never shows a mid-fade colour (2026-10-12).
  - A ring on a two-line headline is drawn round the block, not per line (D88).
  - Typing in a field does not switch to the keyboard ring (D93).
  - 44px targets drawn with `::after` subtract the hairline: a 36px button with -4px reached only 42px (#116).
- **Glyphs and art.**
  - The plus and the More dots were too thin. Now Phosphor bold, with More as three drawn circles of radius 20 (2026-10-10).
  - Icon swaps scale from 0.95, not 0.6 (2026-10-11 audit).
  - Covers are `draggable="false"`, so a mouse flick closes the player instead of dragging an image (2026-10-10).
  - A cover that cannot load shows its palette, never the broken-image glyph (D93).
  - A headline keeps a hyphenated word whole with `inline-block`, so `text-wrap: balance` still works (D93).
- **Rows and lists.**
  - Settings rows hover as rounded tiles clear of the hairlines, like the model list's options (2026-10-11).
  - Hairlines run full-bleed past the gutters.
  - One row height per kind: 72px for sources (D89), 88px for suggestions from 40rem (D91).
  - The Generate bar's line shows only while the bar is really stuck (D87).
  - The section strip is opaque, so text never shows through under it (D88).
  - List edges fade only where more content exists (`player.css:2087-2173`).
- **Speech and status.**
  - One element speaks each message: a polite region, an alert region for errors, and a toast with no role (2026-10-10).
  - The live region stays quiet whenever a visible notice already speaks (D90).
  - The spoken word's fill appears at once, and only the leaving word fades (D105).

### Reading pages and the Library
- **Hero.**
  - One filled action, which goes tonal while playing and shows the time left (D77, D88).
  - One hero layout for any title length.
  - Sections separated by space alone.
- **Play chip.**
  - One width; Played shows Play again only under a mouse or focus (D106, #116).
  - Its state machine: idle, current, played, preparing, error, unavailable.
- **Library.**
  - A cover grid with one facts line per card (D78).
  - Search, filter and sort live in the address.
  - Search matches word starts (D95), with excerpts that start at the hit.
  - Played and progress marks agree across every surface (D97).
  - `content-visibility: auto` on cards.

### Settings and forms
- **Structure.**
  - Two levels, one job per page, a breadcrumb title, autosave (D51).
  - Rows hover as rounded tiles clear of the hairlines.
  - The score is a star and a number (D103).
  - The edit source panel uses token spacing, with "Scorecard" on the left and "x.x/5" on the right, and an empty state (#122).
- **Saving.**
  - No toast while saving or once saved; the control shows the change and a screen reader hears "Saved." (D115).
  - Saved values show for three minutes before the build (D79).
- **Selects.**
  - Every select is `appearance: base-select` with a drawn list (D51).
  - Long lists get a searchable picker: about 55 zones as "Stockholm (GMT+2)", voices by name, gender and accent (D101).
  - Model headings sit on the left in regular weight (D113, #125).
- **New episode form.** Title, Topics, Length, Look back; Format, Voice and Tone under More options; the button reads "Generate • N mins" (D114).

### Sound
- **Engine.**
  - Fourteen procedural recipes from one wooden-bar voice in D major pentatonic.
  - Peaks at most -13 dBFS; four voices at most.
  - Direction carries meaning: up is forward, on and open.
  - Narration is sacred: cues are skipped or ducked while it plays (D18, `design/sound-design.md`).
- **Wiring.**
  - Every enabled control sounds by kind (navigate, select, tap, open and close).
  - Hover, focus, scroll and typing are silent.
  - A save that went through is silent (D101).
  - On iOS the unlock sets `audioSession.type = "playback"` (D105).

### Accessibility as design
- **Targets.** 44px on every visible control on every route, tested; 36px faces get a pseudo-element target.
- **Focus rings.**
  - A 2px outline with a gap in the local surface colour; outlines rather than shadows, so forced colours keep them.
  - Ring shapes follow the visual (tile, pill, thumb).
  - Pointer users see no ring on programmatic focus.
- **Keyboard and screen readers.**
  - The transcript and the Stories list are each one Tab stop.
  - Tab follows the visual order, using `reading-flow` where supported.
  - One live region speaks each message (D90).
- **User preferences.** `prefers-contrast: more` strengthens hairlines; `prefers-reduced-transparency` makes the scrim opaque.

## 3. Reversals, and the lesson in each

| Flip | Decisions | Lesson |
| :--- | :--- | :--- |
| Time zone removed, then asked back | D89, D100 | Do not remove a control the owner asked for to simplify; ask first. |
| Format and second voice removed, then back | D91, D100 | A control that does not act yet is still wanted when it states intent. |
| Bar chevron added, then removed | D85, D102 | The whole bar is the control; extra affordances read as clutter. |
| Source names as links, then plain text | D69, D83 | One element, one job: the row opens the editor. |
| Saved toast and "Live in about a minute" line, then silence | D79, D115 | Truthful status the owner did not ask to see is noise. |
| General audience and its preset Undo, then retired | D67, D87, D114 | A mode one person never uses is cost, not choice. |
| First-load budget 110, 150, then 109 KB | D53, D103, D112 | A loose ceiling lets pages grow by a third unnoticed. |
| Player corners round in travel, then square throughout | D32, D111 | One edge throughout reads as one object. |
| Default (automatic) model row, then removed | D106, D113 | A choice that names nothing hides what is happening. |

The pattern: a simplification taken without asking tends to come back. A removal that comes from the owner sticks.

## 4. What the code already does well

Worth keeping, and worth copying into new work:
- **Tests hold the craft.**
  - `styles.test.ts` bans raw colours and lengths, `transition: all`, literal durations, hover outside `(hover: hover)`, raw z-index, a third weight, press scale on word controls, and em dashes.
  - `buildTokens.test.ts` holds contrast, motion policy and the reduced-motion remap.
  - The browser suites hold 44px targets, rhythm, axe in both themes, and navigation speed.
- **Interruptible physics.** The spring carries velocity, there is one progress scalar, the state machine separates "committed open" from "position", and the document goes inert the moment an open is decided (`player/core/sheetController.ts`, `spring.ts`).
- **No-shift layout techniques.** Fixed-width chips, hidden sizer copies, checks that take no room, a stable scrollbar gutter, scroll-lock that re-applies the gutter, and reserved rooms for notices.
- **Perceived speed.**
  - Modulepreload links checked at build.
  - Idle loading only while online, because a failed import is remembered.
  - The early-tap capture.
  - A service worker answering moves from a 10-minute copy and swapping in the new page only if untouched.
- **Ambient light** degrades in four steps (WebGL, CSS, still, nothing) and comes with a contrast proof.

## 5. Gaps in the code

Each was found by the code read; the first five were checked by hand on 2026-10-14. None is visible to the owner today. Each is a place where the next change can drift.

1. **Raw values the tests miss.**
   - `scale(0.95)` at `buttons.css:190`, `player.css:166`, `primitives.css:394`.
   - `scale: 0.97` at `picker.css:134,164`, `multiselect.css:173,180`.
   - `scale: 0.6` at `primitives.css:679`.
   - Meanwhile the speed panel uses `--scale-enter` (0.96). Popovers enter at three different scales.
2. **A forced-colours blind spot.** The allow-list regex `\bHighlight\b` does not match `HighlightText`, so `primitives.css:723` and `player.css:2189` pass unchecked.
3. **Stale references.**
   - Four comments cite `pressText.test.ts`, which no longer exists; the rule lives in `styles.test.ts`.
   - `sheets.css:46` says the phone sheet's top corners are round, but `:119` sets `border-radius: 0`, per D106.
4. **Unused tokens.** These are referenced nowhere outside `tokens.css`:
   - `--toast-radius`, `--duration-theme`, `--spring-pop-bounce`, `--player-tint-mix` and the `--breakpoint-*` set.
   - The code read counted 62 of 376 in all.
   - `tokens.json` still promises a per-digest cover accent that nothing implements.
5. **One value, two homes.**
   - Spring durations live in `spring.ts:32` and in `tokens.json`.
   - The hysteresis value lives in `Scrubber.tsx:56` and in its token.
   - State-layer percentages are hard-coded in `hero.css` and `settings.css`, outside the two files the test checks.
6. **Duplicated components.**
   - Two segmented controls (`player.css`, `settings.css`).
   - Two switches (`sheets.css`, `settings.css`).
   - Three sheet systems, each with its own transition list.
   - 36 button class signatures, against a census target of four primitives (`design-systems-audit.md`).
7. **Breakpoints and timings written many ways.**
   - The same three breakpoints appear as `min-width`, `max-width: 63.9375rem`, `not all and`, `width <` and range syntax.
   - Idle timeouts of 4000, 3000, 2000 and 200 ms.
   - Scroll thresholds of 64/12 px for the app bar and 48/8 px for the floating button.
8. **Layout properties animated.**
   - The floating button animates `max-width`, `margin` and `inset-block-end`; the briefing tabs animate `inset-block-start`. Transforms would avoid layout per frame.
   - `will-change: transform` sits permanently on the scrubber thumb.
9. **Reduced motion is zero, not gentler.** Durations collapse to 0.01 ms and cross-fades go with them; the spec says "fewer and gentler, not zero" (DD-003, open).

## 6. Owner asks with no record of being done

- The About text being gone (owner list of 2026-10-12).
- The New episode button at the navigation items' size (same list).
- The Apple touch icon's alpha: iOS composites it on black (DD-006).
- The played chip growing 11px with a mouse (state.md).
- A real-phone check of the bottom stack, and Safari 27 and WebKit for everything; neither has run.
- Settings changes reaching pages other than Settings instantly. Today they take about a minute through commit and redeploy (D79).

## 7. Dreams

Ideas the record points toward. Each has its value, its cost and the mechanism behind it. Ordered by what I would do first.

| # | Idea | Why it fits this owner | Mechanism | Cost |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Settings live everywhere** | "Reflected instantly" is met only on Settings; every other page waits a minute. | Read schedule, topics and writer at request time from Vercel Edge Config or Blob, with the repo still the record (the config workflow writes both). Pages read runtime config instead of build-time imports. | Large: an architecture change; touches the build, CSP and caching (D79). |
| 2 | **Rubber-band the player and sheets** | Native sheets resist past their rest; ours stop dead (`gestureMath.ts` clamps 0 to 1). | Past the bounds, map travel through `x * (1 - 1/(x*k+1))`, then let the settle spring return. Apply the same to the native and create sheets, which have no drag to dismiss at all. | Small to medium; the spring and state machine already exist. |
| 3 | **One sheet, one segmented control, one switch** | Three sheet systems drift (one had round corners in a comment and square in code). | One `Sheet` primitive with three presentations (bottom, side panel, centred), one timing list and drag on all; fold the duplicate segmented and switch rules. | Medium; mostly deletion, and the browser suites guard it. |
| 4 | **Shared-element cover from card to page** | The owner asked for the cover to grow from the bar; the same grammar from a Library card into the episode hero would make the app feel continuous. | A view transition on the cover only (`view-transition-name` set at the press), keeping chrome still as `view-transitions.css` already does. Not for the player, whose motion must stay finger-driven. | Small; scoped to one element, skipped under reduced motion. |
| 5 | **Haptics paired with sound** | Every control already makes a sound by kind. On Android a 5 to 10 ms tick on detents, toggles and the open threshold is the native feel. | `navigator.vibrate` in the same map as `soundMap.ts` and `uiCues.ts`, gated by the Sounds setting and absent on iOS. | Small. |
| 6 | **Token hygiene pass** | The tests are the craft's memory; they have blind spots (gaps 1, 2, 5). | Route the raw scales through `--scale-*`, extend the forced-colours regex, make `spring.ts` read durations from tokens, delete the 62 unused tokens or wire the cover accent, and unify breakpoints in one `@custom-media` file built from tokens. | Small; no visible change. |
| 7 | **Reduced motion done right** | The spec says gentler, not zero (DD-003). | Keep durations and zero only travel (`--translate-enter: 0`, `--scale-enter: 1`), so fades keep their timing. | Small; one token remap and its test. |
| 8 | **CSS Highlight API for the transcript** | The spoken word must never lag (D105). Today each word is a span whose class changes. | `CSS.highlights.set('spoken', new Highlight(range))` paints the word without touching the DOM, which also helps a long transcript on a slow phone. | Small to medium; Chromium and Safari 17.2+, with a fallback to today's spans. |
| 9 | **A per-digest accent in the player** | Promised in `tokens.json`, never built. A briefing's own hue in the scrubber fill and the playing chip ties cover, ambient light and controls together. | `--cover-key` already reaches the frame; derive an accent with `oklch(from var(--cover-key) ...)` clamped to the contrast floors the ambient proof uses. | Medium; needs the contrast proof extended to controls. |
| 10 | **A generating card in the Library** | The run card shows stages; the Library shows nothing until the episode lands. | A placeholder card that draws its cover as stages complete (the cover generator is deterministic from the id) and becomes the real card on publish. | Medium. |
| 11 | **Toast swipe and hover pause** | Every other floating surface responds to the finger. | Swipe sideways to dismiss on touch, pause the 5 s timer on hover or focus (`Toaster.tsx`). | Small. |
| 12 | **Ambient light that breathes with audio** | A dream with a risk: it could become a gimmick. | While playing, modulate the canvas opacity by plus or minus 3% from the narration's RMS, sampled at 10 Hz; off under reduced motion and data saver, never on the CSS layer. | Small to build, and taste decides. I would prototype it and let the owner judge on a phone. |

### My picks
- **Ask the owner first: 1.** It is the only item that makes the latest ask, "settings reflected instantly", fully true. It is also an architecture decision.
- **Build now: 2, 6 and 7.** They are cheap and invisible until they matter, and they protect the "nothing moves that I did not move" taste.
- **Prototype: 12.** It is the one taste call worth showing the owner as a recording.

## Keeping this file

When an ask changes the look or feel:
- Add a row to section 2 with its decision number.
- Move an item out of section 6 once it is done.
- Strike a dream once it is built or rejected.

Do not restate a decision's reasoning here; link it.
