# Design engineering ledger

Every design-engineering tweak and visual change asked for on this project, what was built, what the code does as a result, where it falls short, and what could come next. Written 2026-10-14; the chat pass added sections 2, 5 and 10 and dated quotes throughout.

Sources:
- `decisions.md` D1 to D115.
- The notes in `history/`, including the two 2026-10-11 audits folded into them.
- `design/design-spec.md`, `design/sound-design.md` and `plan/vision.md`.
- `learnings.md`.
- Every local Claude Code session on this repo, 2026-10-05 to 2026-10-14 (14 transcripts: the owner's messages, the replies and the compaction summaries), and the cloud session of 2026-10-14.
- A read of `apps/web/src`, `packages/` and `tokens/`. File and line references were checked against `main` at `8549f27`.

Each fact links to its decision rather than restating it; if this file and a decision disagree, the decision wins. A date in brackets, such as (2026-10-08), marks an ask that lives only in a chat.

**For an agent starting UI work:** read section 1 (taste), section 2 (how to work), section 11 (the phone), then the surface you are touching in section 3. Check section 8 before you build something the owner may already have asked for.

**For enriching the design-engineering skill:** section 10 lists each lesson with its target skill, whether the skill already covers it, and the rule text to add.

## 1. What the owner wants, in one page

Patterns from about 150 asks, strongest first.

1. **A real app, not a generated page.** The owner called boxed outlines "ai slop" twice (D72, D76) and keeps naming references to copy rather than invent:
   - Google Podcasts and YouTube Music for the whole app (D31).
   - Material 3 tonal surfaces (D72).
   - Anthropic's model list for every dropdown (D51).
   - Speechify for the transcript (D50).
   - Android's rule for the floating button (D52).
   - Native app behaviour for the bottom stack (#120).
   - The first brief set the bar: "a beautiful audio player experience that is snappy, feels like native player, and has beautiful cover art" (2026-10-05).

   Read a new ask as "how does the reference product do this", not "what would look nice". Names follow the reference too: "A real podcast app never has a menu called archive" (2026-10-07), so Archive became Library.
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
   - Plain labels: Format, Custom, AI model, Last updated (D83, D102). A model named by its name, never by id (D101). The model is one select on Settings, not a page (D123).
   - One noun for one thing: the third critic round found "five spellings of one noun" (D89). "Story" everywhere in the player (D90).
   - A failure is told once, in one place (D94). A status line is three or four words: "Episode queued", "Writing your episode" (D84).
   - No hedging helper text, and a plainer About (#68, 2026-10-10).
   - Content is brief too: headlines up to 12 words, summaries of 25 to 80 words (D12, D34). The digest has no emoji, no intro paragraph, no dividers and no sign-off (`plan/vision.md`).
   - One filled action per screen: the hero's Play (D77), an empty state's single button (D96), New episode in its own tone so it never competes with Play (D86), the open player's Play disc (`player.css:1548`).
   - Colour is information, not decoration. The bar's play "doesnt need a blue background... catches unnecessary attention", and the bar lost its hover tint (2026-10-08). Delete is red only inside its confirm dialog (`episode-actions.css:152`).
   - One of each. "Two playback timelines... remove the duplicate" (2026-10-08): one timeline, owned by the bar, with chapter ticks. One transport on screen (D92). Siblings share one size: "Make them all equal sizes" (2026-10-12).
   - Content is the owner's voice: "high brevity, thoughtful, and concise" (2026-10-05). Decorative furniture goes: "Thought of the Day" was cut (D8). Daily is short, weekly is deep.
7. **Every control is complete.** It gets a 44px target (test in `e2e/layout.spec.ts`), a sound (D101), a press state that never shrinks words (D72, `styles.test.ts`) and a focus ring that survives forced colours.
8. **Bans.**
   - From the persona: cream backgrounds, italic accent words, "01/02/03" labels, monospace eyebrows, all-caps labels, gradient washes, grey shadows, terracotta.
   - From the record: a chevron on the bar (D102), a grabber on phone sheets (D106), a drag handle on the player (D111), a Dry tone (D101), the General audience (D114), em dashes (`houseRules.test.ts`).
   - From the chats: a meta line above a headline, locked or disabled topic choices, a combobox for the model, a vendor prefix or model id in any label, "Create" as a navigation tab.
9. **Hierarchy by size and space, never by crowding.** "I hate these smaller texts... very close to other bigger texts... never want such bad typographic decisions" (2026-10-07). A secondary line goes below its title with a full spacing step, never above it (D31). "Breathable" means a full step between a control group and the content it controls (2026-10-12). Every page title uses the detail-page size, and chips and tabs get side padding for balance (2026-10-12).
10. **Taste-neutral choices are delegated.** "You choose a good one" and "you decide voice limits" (2026-10-05). Decide, state the assumption in one line, and move on. Ask only when the choice changes what the owner sees or pays.
11. **Polish is iterative.** "It's a good improvement, but I still anticipate a lot of fine tuning" (2026-10-12). Plan for rounds of screenshot review, not one pass.

Repeat asks are the clearest signal of what was not heard the first time:
- Stories and Transcript tabs: "I've told you multiple times, but you still decide to skip it" (2026-10-12, D101).
- The time zone, removed in D89 and asked back in D100.
- Format and the second voice, removed in D91 and asked back in D100.
- About, "completely removed from before", restored with the version (2026-10-12). Never delete content in a redesign unasked.
- Handle and square top corners, asked again on 2026-10-14 because the first pass covered form sheets only (D111).

## 2. How to work with the owner on UI

The loop that produced the work the owner liked, and the misses that taught it.

1. **Start from a reference.** Name the product being copied (Google Podcasts, YouTube Music, Material 3, Mobbin screens) before drawing anything. Load the design-engineering skills at the start of UI work (2026-10-05).
2. **Read the notes the owner leaves.** The owner leaves Agentation "Page Feedback" notes, each with a viewport and a CSS selector. Fix every note, including the ones that only ask for parity between two pages. Route each note to the worker already in that file (2026-10-08, 2026-10-12). Agentation runs only under `npm run dev`; `checkBundle` fails a build that contains it.
3. **Organise, push back, then list.** Read the whole list, group related asks, challenge what conflicts with an earlier decision, then build in order (2026-10-12). A repeat ask goes to the top.
4. **Screenshots are the review.** Take them at 1526x782 and 390x844, in light and dark, and look at them yourself before claiming done:
   - Open states count: open dropdowns, the open player, a sheet, the playing state. Two workers shipped popovers that were never seen open (2026-10-09).
   - Screenshots caught what tests missed: a stray error icon, Previous on the phone bar, a 56px gap under the bar on a tablet (2026-10-08).
   - Headless Chrome enforces a minimum window width, so a phone shot needs device emulation or a 390px iframe (2026-10-05).
5. **Approve art before wiring it.** Covers and other generative art go to a contact sheet first; the owner picks, then the generator is wired (2026-10-05, 2026-10-13).
6. **Say what you could not verify.** Headless runs cannot show iOS audio against the silent switch, lock-screen controls, gesture feel, a real address bar, or how the sounds sound. List these every time. `docs/prototype/sound-lab.html` exists to audition sounds.
7. **Ship in small pieces.** Branch, commit, push and open one PR per piece; the owner merges ("do github things after every big change", 2026-10-12). Fan out to cheaper parallel workers on disjoint files, review their diffs yourself, and run the full suites on the combined result: real seams (two theme stores, a header that listened for the wrong attribute) appeared only after merge (2026-10-05).
8. **Report guardrail moves.** When a budget or a rule has to move (the bundle ceiling crept 100, 102, 103, 104 KB), say so and offer the choices: keep it and lazy-load, raise it, or remove it (2026-10-09).
9. **Measure before tuning speed.** Profile on a throttled phone (Pixel 7, 4x CPU, fast 3G, behind a gzip proxy, since the test server sends uncompressed files) and report move timings, LCP and time to a pressable bar. Never trade instant navigation or the early Play tap for bytes (2026-10-08, 2026-10-14).
10. **When the owner is stuck on a manual step**, give numbered click paths with fixed landmarks, not options (2026-10-06).

## 3. The ledger, by surface

Ask, then what was built, then the decision. Values are as built.

### Look, tokens and type
- **Look.** Hand-written CSS from DTCG tokens, Base UI for accessible parts; Tailwind and shadcn rejected as a templated look (D4). The first ask was "a light ui library to keep things elegant and high quality" (2026-10-05).
  - Pipeline: `tokens/tokens.json` to `scripts/buildTokens.ts` to the generated `styles/tokens.css`.
  - Tests check token drift, tiers and contrast. Tokens for type, colour and spacing were an explicit ask; 18 raw values were tokenised in one pass (2026-10-08).
  - The first identity (2026-10-05) was a reading page built as the audio timeline: a vertical rail with a node per story that filled while playing, Schibsted Grotesk with Literata, a Lingonberry accent, no cards and no hairlines. It gave way to the Google Podcasts redesign (D31), then to Material tonal surfaces and Google Sans Flex (D72). The rail survives only in the Generate step list.
- **Tonal language** (D72, owner: "a real Google app"):
  - `surface-container` for the page's own controls.
  - `accent-container` for chosen or current.
  - `accent-container-high` for actions that are not places, such as the phone's floating New episode (D86); in dark it is blue-910, a lifted step like light's, never a fill (2026-10-23). In the rail New episode takes `surface-container` with accent ink, so beside the current row it is not a second selection (owner, 2026-10-22).
  - State layers: hover 8%, press 12% of the control's ink.
  - Pills for buttons, chips, select chips, select values, segmented controls and the search field, in a card as on the page, and for every select in a form (D169: the Create sheet, the Add panel, the multi-select; text fields keep 8px) (D167, 2026-10-23: "that shouldn't be possible in a design system"). For one day (2026-10-22) chips and select values in a card took the card's concentric radius; the owner reversed it on the phone. 12px rows, outlines only on text fields (3:1, D54).
- **Type.**
  - One family: Google Sans Flex variable, latin only, with a metric-matched Arial fallback.
  - Two weights, regular and medium; a test bans a third (D90).
  - Story and summary 16px at every width; headline 18 to 20px; meta 14px; section headings 22px regular; display at most 32px; reading leading 1.55 (D73).
  - A quiet line goes under its title, never above it (D31); a story's publisher is the one exception, above its headline (D161).
  - Summaries and highlight text take `on-surface-reading`, one ink step under the headline (light grey-750, dark grey-400): size and weight are fixed, so contrast lets the headline lead; AAA on the page, tested (2026-10-23).
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
  - A 512-byte head script applies the stored choice before first paint (D20). Anything else a page restores, such as the Library's gallery or list view, waits one frame for the page script, because the head budget has no room (2026-10-08).
  - One store: `dispatch:preferences` (`player/core/preferences.ts:9`, `themeInit.js:3`). Two keys once lived side by side, and the player cleared a stored dark theme (2026-10-05).
  - The theme change crossfades with a view transition, and `theme-color` metas follow. It first decodes the new theme's covers on screen (at most 400 ms), and the bars fade inside the page's picture, after "there is a glitch in the screen when I switch the app theme" (2026-10-16, D122).
- **Ambient light.** The ask was "clever integration of shaders but mild" (2026-10-08, D48).
  - A CSS field of the cover's colours, with a 128px WebGL canvas faded over it.
  - The colours are the ones the art is drawn in: "make sure the blur/shader in the podcast details page header matches the color of the albumart" (2026-10-14). The light had read the cover's palette id, while monthly covers (D110) are dressed from their season and older episodes are inverted. `coverColors` (`packages/cover/src/context.ts`) now gives the renderer and the light one answer, and a test checks that its colours appear in the drawn SVG.
  - Asked again: "the shader color should match the colors of the album art every time", "natural and not very elliptical", movement welcome (2026-10-16, D122). The colours are now read from the drawn image per theme (`coverSwatches`): the largest colour, then the two most eye-catching, never dark ink. Three round gaussian lights placed from the measured cover drift on a 40 s loop; the mask only fades the layer's edges.
  - 30 fps, off-screen paused; off for reduced motion, data saver and software renderers.
  - Software renderers are found by name, because `failIfMajorPerformanceCaveat` lets headless SwiftShader through: `WEBGL_debug_renderer_info` against `/swiftshader|llvmpipe|softpipe|software|basic render/i` (`ambientLight.ts:114`).
  - Light mode was "coloured but still faint", so the tint was remapped (0.6 light, 0.32 dark) rather than dropped (D77). The contrast proof loops every palette in both themes; the worst text is 4.78:1.
  - The field bleeds past the gutters by `min(space-12, gutter)` so the phone app bar never clips it, and hero chips sit on the surface colour (`ambient.css:32`).
  - Cost: 317 B gzip eager, 2 KB lazy on idle.
- **The playing cover's light** (D123): "Light animation of album art when playing". The cover, blurred, glows behind the open player's cover while it plays, fades on pause, breathes on 4.2 s; still under reduced motion.
- **Launch screen** (D123): "Flash screen design animation for pwa - dark & light". Installed app only; the ringed dot sends out two rings and lifts away in about 0.9 s.
- **Android bars** (D123): no manifest colours, so the navigation and status bars follow the system theme; a light theme_color had frozen a white bar that hid the buttons.
- **Covers.**
  - The first set (2026-10-05): eight templates (spring, dither, contour, numeral, lattice, orbit, aperture, band) over OKLCH palettes, chosen by seed. Forms come from the craft the briefing covers. One gesture per cover, one accent, flat colour. Neighbours never share a template; weekly covers sit matted inside a ground border; your own episodes are inverted (2026-10-08).
  - The social card is composed at 1200x630, never cropped from the square.
  - Monthly schemes from 2026-10 (D110).
  - Medium chroma, 0.12 or less, after "too saturated ... too much on the eye when multiple albums are viewed at the same time"; three monthly series with their own style sets, all printed on the month's paper in its inks, on three close tints (weekly palest, then on-demand, then daily) after "the albums should be in a harmony"; crisp in the light theme and faded in the dark; the year after the month; the weekly range reads "2 – 8 November" (2026-10-15, D121).
  - A step brighter in both themes after "too dull in both dark and light theme" (2026-10-16, D122): paper 0.80 to 0.92 light and 0.73 to 0.85 dark, full chroma on the dark page, and a card's progress scrim on the bottom quarter only. Then "slightly saturated as the colors are too dull": paper chroma 0.045 and spot and tint 25% richer, under the 0.12 cap.
  - Contrast held by `TYPE_CONTRAST` and `FORM_CONTRAST`; date text sits at 11 to 16:1; topic-art letters use the inverse text at 4.5:1 (`cover/src/palettes.ts:137`).
  - The Strata, Orbits and Facets redesign was rejected as busy: an outlined numeral, strokes crossing the digits, and titles unreadable at 48px (2026-10-13).
  - Reviewed on a contact sheet with a 1080-render crash sweep before wiring (2026-10-05).
- **Generated topic art** from id and name (D102).
- **Empty states.**
  - The ask was "beautiful empty state illustration with title and an action button", then "keep the illustrations simple" (D96, D98).
  - Each is one flat object of two to four shapes in theme tones, then a 22px title, one line and one filled action.
  - Inline SVG, no script.

### Motion and navigation
- **Navigation feel.**
  - The ask: "there is a delay in switching between different nav menu pages, I want the app to be snappy, performant" (2026-10-08).
  - A move between pages took 400 ms, mostly an accidental default crossfade. It is now answered from a saved copy: 2 ms for the page, 32 ms to the new page on screen, 132 ms fully drawn (D47).
  - Why the crossfade ran: Astro's swap keeps only a fixed set of root attributes, so `data-astro-nav` was dropped and the 330 ms default played. `navigation.ts:77` carries it onto `event.newDocument` in `astro:before-swap`.
  - The incoming page fades up in 100 ms, with an 8px settle into or out of a briefing.
  - `navigationBoost.ts` replaces the view-transition snapshot with an immediate swap: a one-shot stand-in for `document.startViewTransition`, branded with a WeakSet, that marks the new document `data-nav-swap` (`:66`, `:118`, `:138`). It skips two frames of snapshot capture.
  - The service worker answers a move from a stamped copy (`x-dispatch-stored-at`): fresh for 10 minutes, rechecked in the background after 15 s, expired when `/latest.json` changes (`sw.js:28-32`). A stale tab reloads once after a deploy, never while offline (2026-10-08).
  - A touch `pointerdown` starts the fetch about 100 ms before the tap ends.
  - The pressed nav item lights up before the page arrives.
- **Motion rules in tokens.**
  - Press in 100 ms, out 160 ms (in faster than out, tested).
  - Durations at most 300 ms, except the 500 ms drawer.
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
  - On a wide screen with a mouse, the bar keeps previous, play, next and the clock (D101): details on the left, transport centred, volume on the right (2026-10-13); the mute button holds the right edge and the level opens to its left (2026-10-18). "In mobile, it's a different behavior, so you need to be mindful" (2026-10-12).
  - Previous shows only on wide screens; the phone bar never carries it (2026-10-08).
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
- **Queue and Up next.** A chevron top left below 64rem shows how to close; a peek strip "Up next" pulls up into a queue sheet with a docked now-playing row; after the end only Up next shows. Drag and pull gestures are untested on a real phone (2026-10-21, D126). The ended view had kept the Stories tab (audit, 2026-10-22): the tab line now holds Up next alone, so nothing under it moves and a focused tab keeps focus, until the recording plays again; `firstPlay.spec.ts` asserts no Stories tab at the end.

### The bottom stack on a phone

The navigation bar, the player bar, the floating button, the run indicator and toasts share the bottom edge below 64rem. Every fix so far, in the order it came:

- **Shape** (D31, D72, D86).
  - A bottom bar below 64rem, a side column from 64rem.
  - Tonal, 4rem tall, with a 64x32 pill behind the current icon.
  - The hairline above it removed.
  - The player bar takes the same `surface-container` fill, with no line between, so the two read as one block in both themes.
- **Current tab.**
  - The destinations are Latest, Library and Settings. Today was renamed Latest (2026-10-14); code ids, comments and older entries in this file still say `today`.
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
- **Close on a full-screen phone sheet** (owner, 2026-10-22). D152: D144 hid the X on every phone sheet; a full-screen one (`dialog.create-sheet`: New episode, the topic and source panel, Regenerate) shows it again at the row's end, as on a desktop. The partial sheets (menu sheets, the emoji picker, the React drawers) keep no X and close by pull or a tap outside. One selector in `create-sheet.css`, under `SheetHeader.astro`.
- **Create is an action, not a place** (2026-10-08). An agent added it as a navigation tab; the owner made it a solid button, then the floating button. It opens a native `<dialog>`, full screen on a phone and a 28rem panel from 40rem, cloned on first press. A history entry lets Back close it (`createSheet.ts:79-90`). The floating button hides while the player or a dialog is open. "Quite cramped" led to a wider panel with spaced groups and the unlabelled mode switch on top (2026-10-12, D114).
- **Run progress is a line, not a page** ("so we dont take an entire page", 2026-10-08). It sits bottom-left of the side column, or as a thin bar over the player bar on a phone. It persists across moves through `sessionStorage` and `transition:persist`, with `role="status"` (`RunStatus.astro:47`). A failed run shows an alert glyph in the danger colour at the same card height, clamped to two lines; dismissing it sends focus to Create, not to `body`.
- **Tablet and phone gaps.** A 56px gap opened under the bar on a tablet while the player was open, and the player's story rows jumped 6px when the story changed; both fixed after screenshot review (2026-10-08).

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
  - The first frame of an episode page drew the first story, then the current one. The page now derives `override ?? first` instead of holding the first in state (2026-10-09).
  - A sticky element centred with `translate: 0 -50%` blurs on odd heights; use a measured `calc()` offset (2026-10-12).
- **Visibility.** `[hidden]` lost to author `display` rules, so hidden elements showed. A global rule keeps it hidden (`foundations.css:158`) and a test walks every page (2026-10-08).
- **Fields and selects.**
  - One drawn list for every select (`appearance: base-select`, set once in `primitives.css`).
    - The text is centred with no UA block padding (2026-10-10).
    - The list opens below its field when it fits, and a phone in landscape still shows more than three rows.
  - The same gap between a value and its chevron (`--field-chevron-gap`), and equal padding in multi-line fields (D106).
  - The model field is as wide as its name, so the hover fill hugs the words (D103). A longer name ends in an ellipsis, not half a name (D91).
  - A field grows on focus only with a fine pointer, so it never moves under a tap (2026-10-12).
  - An open list lifts its row above the next one (`.rows > :has([aria-expanded="true"])`, 2026-10-11).
  - A list that fails to load says so inside the open list (2026-10-12).
  - The ask for lists: "styled better in the same theme and... consistent with good padding on the top and bottom" (2026-10-09). Equal inner padding top and bottom, on the page's surface.
  - The model field is a plain select, never a combobox. Its list has Top and All groups; the switch deleted 640 lines (2026-10-13, `primitives.css:487`).
  - A searchable picker is placed once, so it closes on any scroll (capture, passive) and takes its `transform-origin` from the trigger's centre (`picker.ts:198`, `:315`). In forced colours its search field keeps a system border (`picker.css:109`).
  - The cadence select clipped "Every second day"; fields are sized to their longest value (2026-10-09).
  - Under 40rem every list that opens from a field is a bottom sheet (D167): a select's drawn list through `::picker(select)` in CSS alone, the searchable picker (`picker.ts` sets `data-sheet`), the multi-select (fixed in place, its card lifted over the navigation bar). The scrim is a spread of the sheet's shadow where the list has no usable backdrop. A select and an input have no tap highlight (`foundations.css`).
- **Press, hover and focus.**
  - Words never shrink on press; label controls show a press on their fill (2026-10-10, `styles.test.ts`).
  - A segmented control's chosen item takes a full outline or container, never only a bottom border: the Gallery and List switch "shows only a bottom border" (2026-10-09).
  - Two targets in one card look different under a mouse: "there is a distinction between clicking on the thumbnail... versus clicking on the text... That distinction is necessary" (2026-10-12, D101).
  - Remove buttons in lists show on hover or focus with a mouse and always on touch (2026-10-08).
  - A focus ring inset into its row stops clipping inside overflow containers (2026-10-08).
  - Hover layers are the fill's own alpha, so a focus ring is never faded (2026-10-11).
  - A colour transition runs on the hover state only, so a theme switch never shows a mid-fade colour (2026-10-12).
  - A ring on a two-line headline is drawn round the block, not per line (D88).
  - Typing in a field does not switch to the keyboard ring (D93).
  - 44px targets drawn with `::after` subtract the hairline: a 36px button with -4px reached only 42px (#116).
- **Glyphs and art.**
  - The plus and the More dots were too thin. Now Phosphor bold, with More as three drawn circles of radius 20 (2026-10-10).
  - Icon swaps scale from 0.95, not 0.6 (2026-10-11 audit).
  - The transport: previous and next take the skips' Phosphor regular outline at their size, so the four helpers are one family and Play the one fill (2026-10-22).
  - Latest is Phosphor FireSimple, rest and current: a plain outline with no inner lick, as "simple outline ones and not have inner details" asked (D133; built 2026-10-22 in `tokens/glyphs.json`).
  - Covers are `draggable="false"`, so a mouse flick closes the player instead of dragging an image (2026-10-10).
  - A cover that cannot load shows its palette, never the broken-image glyph (D93).
  - A headline keeps a hyphenated word whole with `inline-block`, so `text-wrap: balance` still works (D93).
- **Rows and lists.**
  - Settings rows hover as rounded tiles clear of the hairlines, like the model list's options (2026-10-11).
  - Hairlines run full-bleed past the gutters.
  - One row height per kind: 72px for sources (D89), 88px for suggestions from 40rem (D91).
  - The Generate bar's line shows only while the bar is really stuck (D87).
  - The section strip is opaque, so text never shows through under it (D88).
  - List edges fade only where more content exists (`player.css:2087-2173`); the create sheet's body fades 32px above its sticky foot the same way, by a scroll timeline (2026-10-22).
  - A source tile's hairline edge is drawn on `.source-icon::after`, so a loaded icon keeps it (2026-10-22).
  - The rail's rows keep 8px apart and each hit area reaches 4px into the gap, so a pointer never falls between them (2026-10-22).
- **Speech and status.**
  - One element speaks each message: a polite region, an alert region for errors, and a toast with no role (2026-10-10).
  - The live region stays quiet whenever a visible notice already speaks (D90).
  - The spoken word's fill appears at once, and only the leaving word fades (D105).

### Reading pages and the Library
- **Hero.**
  - One filled action, which goes tonal while playing and shows the time left (D77, D88).
  - One hero layout for any title length. The hero text fills the cover's height; a gap under it came from a `1fr` middle row with `align-self: end` actions, fixed with an 8rem cover (2026-10-12). On a phone the stacked cover is `clamp(8rem, 36vw, 10rem)`, never smaller than the wide layout's (2026-10-23).
  - Sections separated by space alone. Hairlines, where they exist, run inside the column (2026-10-08).
  - "Contents" sits beside the episode, sticky at the vertical centre (2026-10-08, 2026-10-12). "N min listen" went; Highlights replaced the script on the page (2026-10-08).
- **Play chip.**
  - One width; Played shows Play again only under a mouse or focus (D106, #116).
  - Its state machine: idle, current, played, preparing, error, unavailable.
- **A story.** The publisher above the headline, muted and whole (D161); under the text one row, the Play chip and the controls at its end, never wrapping (owner, 2026-10-22 and 2026-10-23). Every quiet line of facts takes one separator: a centred dot in a 12px box (`--meta-dot`, 2026-10-22).
- **Library.**
  - A cover grid with one facts line per card (D78).
  - Search, filter and sort live in the address.
  - Search matches word starts (D95), with excerpts that start at the hit.
  - Played and progress marks agree across every surface (D97). A card's progress is its `::before`, because `::after` is the press layer (`library.css:72`).
  - `content-visibility: auto` on cards.
  - Titles clamp to two lines (`library.css:98`) and generated names stay short ("AI Products, Design and 2 more"), with a tooltip for a truncated title under a mouse (2026-10-08).
  - Filters All, Daily, Weekly and Custom; Oldest first reverses same-day cards too; the count reads "1 of 5 results"; a touch-only Clear text button (2026-10-08).
  - Deleting an episode hides it at once on this device and lands on the Library while the 2 to 3 minute workflow runs (2026-10-08).
  - A three-dots menu per row (Download, Add to queue, Regenerate, Share, Delete); a downloaded row has a filled check-circle with a hidden "Downloaded" (D127). A phone has no sort, and the chips (16px side padding) share a line with the view switch, scrolling at 360px (2026-10-21).

### Settings and forms
- **Structure.**
  - Two levels, one job per page, a breadcrumb title, autosave (D51).
  - Rows hover as rounded tiles clear of the hairlines.
  - A row's value sits at its end, not under its name, which read as squeezed; summaries are short ("Every other day at 7", a source count) and rows with nothing to say have no line; podcast topic chips go by name; an unticked chip in a card has its own tone, as dark mode's raised tone equalled the card (2026-10-22).
  - A card's row tiles and buttons are concentric with it, radius = card radius less the gap: 24, 16 (8px in), 8 (16px in). Chips, select chips, select values and segmented controls keep their pill inside a card (D167; on 2026-10-22 they too were concentric, measured within 1px with `component.card`).
  - A Sources row and a source row sit 16px in, the search field's own padding, so the emoji and the chevron line up with the field's glyph and clear button (owner, 2026-10-23); the chevron was pulled out to the edge before (`topics.css .row-action`, `.source-row`).
  - One left text edge, roomier cards: "the padding around the list menus in settings page and other pages must be spacious and the text elements must be horizontally aligned to the left to have optical cleannes" (owner, 2026-10-22). The title, group heads and notes outside a card start the card's padding in, so they share the rows' edge (`settings.css`, any `.settings-view` or `.manage` holding a `.card-group` or Change log entry). The card's words went from 16 to 24px in, its tiles and select fills from 8 to 16px in on every side (the card adds 8px above and below, each tile takes 8px inside its 64px row), so the radii became 32, 16 (16px in), 8 (24px in). Rows keep 64px. Measured at 390 and 1280px on Settings, Daily, Weekly, Preferences, About, Privacy, Sounds, Voice, Change log, Costs and Blocked sources: one edge, 0px spread (16px before). Sources and a topic page have no `.card-group` and lead with an icon, which holds the edge (`primitives.css .card-group`, `component.card`). On Blocked sources the field's label, its words and its error take the same edge, its outline hanging out as a card's does (`blocked.css`). A topic page's Listen in line is pulled out by the card's padding, its select and the source tiles sit one inset in at the tile radius (`topics.css`). The owner kept it (2026-10-23): a Settings title sits 24px further in than Library's and Latest's, so it moves between tabs; one edge within a page wins.
  - The score is a star and a number (D103).
  - The edit source panel uses token spacing, with "Scorecard" on the left and "x.x/5" on the right, and an empty state (#122).
- **Saving.**
  - No toast while saving or once saved; the control shows the change and a screen reader hears "Saved." (D115).
  - Saved values show for three minutes before the build (D79).
- **Selects.**
  - Every select is `appearance: base-select` with a drawn list (D51).
  - Long lists get a searchable picker: about 55 zones as "Stockholm (GMT+2)", voices by name, gender and accent (D101). The offset is computed at an instant, daylight saving included (`packages/core/src/time.ts:78`), because "time zone should be mentioned... GMT plus or minus" (2026-10-12).
  - Voices are auditioned in place (D105); the owner also asked for preview in the New episode form (2026-10-12).
- **Lists.**
  - Lists come first with their counts; add forms sit in `<details>`; repeated hints and the Generate row went (2026-10-08).
  - "N topics" heads the list with a mid-size Add on the same row; a topic shows seven sources, then "Show N more" (2026-10-13). Reversed by D125: no count, no filters, a floating Add on a phone and an Add at the end of the search row from 64rem.
  - Headings: never bold, anywhere; Settings group heads are 18 to 20px regular H2s (22px was too big), apart from the title by size and space only (D125). A topic's sliders fold into Topic weightage, Formats and Perspective groups; its formats are tabs, All first; Listen in sits in the card (D125).
  - Daily and Weekly share one component, so a change lands on both (2026-10-13).
  - Topics are always available: no locked or disabled choices. A locked chip at opacity 0.32 read at about 1.5:1 (2026-10-12).
  - Source icons come through `/api/site-icon` with a letter fallback, so the policy keeps `img-src 'self' data:` (`pages/api/site-icon.ts`); widening `img-src` to `https:` was rejected (2026-10-09).
  - The add-topic form uses `novalidate` with inline messages; an emoji-only name no longer becomes the id "topic" (2026-10-08).
  - Model headings sit on the left in regular weight (D113, #125). The emoji picker's section labels are h3s and were bold by the browser's default; they are regular (audit, 2026-10-22, `topics.css .emoji-label`).
  - The emoji picker's list was late (owner, 2026-10-24): drawing all 1,878 emoji in one task held a cold open for 1.3 s on a desktop. Each cell now renders only near the view (`content-visibility`), the list fills in batches of 120 after the first category, and hovering, pressing or focusing the button preloads it (`emojiPicker.ts`, `topics.css .emoji-cell`).
  - Each emoji sits in its cell's optical centre: a pad of a tenth of the font size moves the emoji font's ink off the UI font's baseline, the same for every glyph (owner, 2026-10-24; exempt in `designSystem.spec.ts`).
  - An emoji cell takes the standard hover state layer under a fine pointer (`.hover-fill`, D72); the chosen emoji's fill and the focus ring win over it (owner, 2026-10-24).
  - The Listen in list on a phone opened under the sticky search block (one under the header), hiding Catch up; the card that holds the open list is lifted to the header's level (audit, 2026-10-22, `topics.css`).
  - Unticked chips in a `.card-group` take the overlay tone, not the raised one: in dark the raised tone equals the card's, so Daily and Weekly's topic chips read as bare text (audit, 2026-10-22, `primitives.css`).
  - The Podcast voice subtitle is only "Daily, Weekly and Catch up episodes are read in these voices." (owner, 2026-10-21); the "Weekly keeps the voice it had before" note is gone (2026-10-22).
  - Blocked sources counts and asks in sources: "1 source", "Block a source" (audit, 2026-10-22). The route stays `/settings/blocked-outlets`.
  - Sources and Preferences are a segmented switch on a topic page (`?view=preferences`); one global type mix on `/settings/preferences`; no breadcrumbs; Theme is a select; Weekly has no switch (D129, 2026-10-21).
  - Review caught a topics tab strip that zoomed Chrome out (a grid column without `minmax(0, 1fr)`) and cramped panel rows, which led to the 8pt spacing system.
- **Costs.** One card: the range and breakdown as small dropdown chips at its top, then one figure with one quiet line (the KPI blocks beside the total read as three competing numbers), a single-hue column chart and the breakdown. The owner wanted the filters inside the chart, over the dataviz rule of a filter row outside it (2026-10-22). At every width the card has its padding on all four sides and the chips its radius less that padding (2026-10-23).
- **New episode form.** Title, Topics, Length, Look back; Format, Voice and Tone under More options; the button reads "Generate • N mins" (D114).
  - The action is called Catch up, the kind its episodes are filed under, on the floating button, the side column, the sheet's title and the Library's empty state; Latest's glyph is a bolt, not a flame (D168, 2026-10-23).
- **Toast.** Swipes away sideways under a finger, springs back from a short drag, never undoes (D168, `Toaster.tsx`).
- **Queue (Up next).** No handle, no cross: a row moves by the browser's drag and drop (long press or mouse pull), swipes left to leave, and its dots open the header's menu with Move up, Move down, Remove (D169). The Stories and Up next switch keeps the segmented look on a phone, in a sticky bar.
- **App bar on a page with a sticky block.** Pinned (`data-pins-bar`): it no longer slides away and back under a topic's search and chips (D169).
- **Section tabs.** 16px each side, the indicator under the words (D169: "placed too close to each other").
- **Costs.** Chart or table by two glyph tabs at the end of the filter row, the segmented navigation made compact (D169).
- **Covers.** Chroma cap 0.16, a deeper, tinted light stock, richer inks (D171: "very dull"); D121's 0.12 cap and pale papers lasted eight days.

### Sound
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

### Accessibility as design
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

## 4. Reversals, and the lesson in each

| Flip | Decisions | Lesson |
| :--- | :--- | :--- |
| Time zone removed, then asked back | D89, D100 | Do not remove a control the owner asked for to simplify; ask first. |
| Format and second voice removed, then back | D91, D100 | A control that does not act yet is still wanted when it states intent. |
| Bar chevron added, then removed | D85, D102 | The whole bar is the control; extra affordances read as clutter. |
| Chips and select values concentric in a card, then pills again a day later | 2026-10-22, D167 |
| Covers capped at chroma 0.12 on pale paper, then a step of colour eight days later | D121, D171 | "Too saturated" and "very dull" are both judged in a grid on the phone; keep the contact sheet in the loop and move in steps. |
| The player's tab line on a phone, then the segmented control everywhere | 2026-10-21, D169 | One control, one look at every width; a phone variant of a control is a second component. | A radius rule that gives one control two shapes reads as two components; judge it on the phone, not in a measurement. |
| Source names as links, then plain text | D69, D83 | One element, one job: the row opens the editor. |
| Saved toast and "Live in about a minute" line, then silence | D79, D115 | Truthful status the owner did not ask to see is noise. |
| General audience and its preset Undo, then retired | D67, D87, D114 | A mode one person never uses is cost, not choice. |
| First-load budget 110, 150, 109, then 130 KB | D53, D103, D112, D141 | A loose ceiling lets pages grow by a third unnoticed. |
| Player corners round in travel, then square throughout | D32, D111 | One edge throughout reads as one object. |
| Default (automatic) model row, then removed | D106, D113 | A choice that names nothing hides what is happening. |
| Timeline rail, Schibsted and Literata, then Google Podcasts, then tonal Material | 2026-10-05, D31, D72 | An invented identity loses to a familiar reference. |
| Archive, then Library | 2026-10-07 | Name destinations as the reference product does. |
| Create as a navigation tab, then a solid button and floating button | 2026-10-08 | An action is not a place. |
| Hairline rows in Settings, then tiles clear of hairlines | 2026-10-08, 2026-10-11 | Separation by space and tone, not by lines. |
| Model combobox, then a plain select | 2026-10-13 | A familiar control beats a clever one; the switch also deleted 640 lines. |
| Locked general topics with a lock glyph, then always available | 2026-10-12, 2026-10-13 | A choice the owner cannot make should not be drawn. |
| Strata, Orbits and Facets covers, then rejected | 2026-10-13 | Generative art is judged on a contact sheet at real size, not in code. |

The pattern: a simplification taken without asking tends to come back. A removal that comes from the owner sticks.

## 5. Hacks and mechanisms

Each answers a bug that cost real time here. Reuse them in any web app; the skill queue in section 10 says where each belongs.

| Problem | Mechanism | Where |
| :--- | :--- | :--- |
| A designed page transition never ran; a 330 ms default crossfade did | Astro's swap keeps only fixed root attributes. Copy custom `data-*` onto `event.newDocument.documentElement` in `astro:before-swap` | `scripts/navigation.ts:77` |
| A select's drawn list cannot have a styled backdrop (lightningcss fails the build on `::picker(select)::backdrop`), and a popover's backdrop lets taps through anyway | Draw the sheet's scrim as a second shadow layer, `0 0 0 100vmax var(--color-scrim)`; a list that is no popover (the multi-select) does the same and its card rises to `--z-sheet` while open | `primitives.css` (the phone `::picker` block), `multiselect.css`, `topics.css` |
| A list placed by script (left, top, width) must become a bottom sheet on a phone | The script sets `data-sheet`, clears its inline style and returns before measuring; CSS under 40rem places the sheet | `scripts/picker.ts` `place()`, `picker.css` |
| A toast must swipe away but never undo, and its buttons must keep their presses | Pointer capture on the toast, not on a mouse and not from a button; `translate` follows the finger with transitions off (`[data-dragging]`); past 35% or 0.6 px/ms it slides on and the store dismisses, else the inline translate is cleared and the transition springs it back | `sheets/Toaster.tsx`, `sheets.css` |
| View-transition snapshots cost two frames per move | A one-shot `startViewTransition` stand-in, WeakSet-branded, that swaps at once and marks the new document | `scripts/navigationBoost.ts:66` |
| First press froze 285 ms | `new AudioContext()` took 221 ms inside `pointerdown`. Create it on the first `pointerdown` or `keydown` and queue the first cue | `player/sound/soundController.ts:81` |
| iOS audio stayed locked | `pointerdown` is not an activation for audio; also listen to `pointerup`, `touchend` and `click` | `packages/sound/src/engine.ts:373` |
| Headless tests ran the WebGL effect on a software renderer | `failIfMajorPerformanceCaveat` lets SwiftShader through; read `WEBGL_debug_renderer_info` and match the renderer name | `scripts/ambientLight.ts:114` |
| A 30 fps cap ran at 20 fps | rAF jitter at 60 Hz; compare against `FRAME_MS - 4` | `scripts/ambientLight.ts:89` |
| The canvas blanked on rotation; the palette went stale while stopped | A resize clears the backing store, so draw inside the ResizeObserver; watch `data-theme` and the colour-scheme query and redraw once | `scripts/ambientLight.ts:196-235` |
| Offline pages missed lazy chunks | The service worker's import follower matched `'` and `"` but the bundler emits backtick imports; match backticks, follow six levels, bump the cache version | `public/sw.js:47`, `:214` |
| Hidden elements showed | Author `display` rules beat the UA `[hidden]` rule; add a global rule and test every page | `styles/foundations.css:158` |
| The CSP blocked page scripts | Inlined assets become inline scripts; `assetsInlineLimit: 0` keeps them files | `astro.config.mjs:150` |
| Favicons needed `img-src https:` | A same-origin icon proxy with a letter fallback | `pages/api/site-icon.ts` |
| The head script could not restore view choices | A 512-byte budget; restore anything beyond the theme one frame later from the page script | `scripts/themeInit.js` |
| Two theme keys fought | One preferences key, read by the head script | `player/core/preferences.ts:9` |
| A phone screenshot looked cropped | Headless Chrome has a minimum window width; emulate the device or render inside a 390px iframe | browser suites |
| A picker list drifted from its field | It was placed once; close on scroll (capture, passive) and set `transform-origin` from the trigger | `scripts/picker.ts:198`, `:315` |
| Specificity lint failed on picker rules | `:is()` takes its highest argument, `:where()` is zero; write `html:is([data-astro-nav="peer"], ...)` and order rules by specificity | `styles/view-transitions.css:49` |
| Time zone labels drift with daylight saving | Compute the offset at an instant with Intl, never store it | `packages/core/src/time.ts:78` |
| Cover fonts lost their weight; renders crashed | resvg ignores variable axes (commit static instances) and aborts on blur inside masks (use gradient masks) | `packages/cover/src/fonts.ts:5` |
| Dev pages shipped in the static build | A page flag still emits HTML. The lab pages went; dev tools load only under `import.meta.env.DEV`, and `checkBundle` fails a build that contains them | `src/dev/agentation.ts:12` |
| Throttled profiles measured the wrong bytes | The test server sends uncompressed files; put a gzip proxy in front | `engineering/first-load-js.md` |
| Browser suites failed to bind | Windows reserves ports 4524 to 4623; use 47xx or 48xx, never 4321 (the owner's dev server) | `AGENTS.md` |

## 6. What the code already does well

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

## 7. Gaps in the code

Each was found by the code read; the first five were checked by hand on 2026-10-14. None is visible to the owner today. Each is a place where the next change can drift.

1. **Raw values the tests miss.**
   - `scale(0.95)` at `buttons.css:190`, `player.css:166`, `primitives.css:394`.
   - `scale: 0.97` at `picker.css:134,164`, `multiselect.css:173,180`.
   - `scale: 0.6` at `primitives.css:679`.
   - Meanwhile the speed panel uses `--scale-enter` (0.96). Popovers enter at three different scales.
2. **A forced-colours blind spot.** Closed 2026-10-22: the check matches every system colour keyword whole and allows `HighlightText` and `ButtonBorder`.
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
   - 36 button class signatures, against a census target of four primitives (`history/2026-10-11-design-systems-audit.md`).
7. **Breakpoints and timings written many ways.**
   - The same three breakpoints appear as `min-width`, `max-width: 63.9375rem`, `not all and`, `width <` and range syntax.
   - Idle timeouts of 4000, 3000, 2000 and 200 ms.
   - Scroll thresholds of 64/12 px for the app bar and 48/8 px for the floating button.
8. **Layout properties animated.**
   - The floating button animates `max-width`, `margin` and `inset-block-end`; transforms would avoid layout per frame. The briefing tabs now glide by `translate`, and the scrubber thumb has `will-change` only while dragged (2026-10-22).
9. **Reduced motion is zero, not gentler.** Closed 2026-10-23: travel collapses and fades keep their time (section 3, Reduced motion).
10. **Found by the chat pass.**
    - A stale comment still describes the removed `.daily-listbox` combobox (`primitives.css:468`).
    - The 36px Topics & sources tab was dropped from the 44px check instead of fixed, and "Add source" measures 121x36 (2026-10-09, 2026-10-13).
11. **Four sheet mechanisms for one look** (2026-10-23). The More menu and the picker are popovers placed by CSS; a select's list is a `::picker(select)` popover; the multi-select is a fixed element inside its card, which must be lifted to `--z-sheet` while it is open and gets its scrim from a shadow. One `Sheet` primitive (gap 6, idea 3 in section 9) would retire the lift and the two scrim hacks. A tap on any sheet's scrim still reaches the page under it.

## 8. Owner asks with no record of being done

Each is a chat ask with no later record of being built or dropped. Check the code before building one; some may have been done without a note.

- The New episode button at the navigation items' size (owner list of 2026-10-12).
- Voice preview inside the New episode form (2026-10-12).
- "Narration is not available", reported 2026-10-12 and never diagnosed.
- Regenerate replacing the item in place while it runs, a menu for built-in topics, and Listen now switching itself on (2026-10-13).
- General chips unticked by default, waiting on an answer from the owner (2026-10-13).
- From the PWA audit of 2026-10-16 (D123), each the owner's call: offline listening of the latest few recordings, iOS startup images in both themes, an iPhone check of the light theme's status bar, and a Gallery and List morph.
- QA defects from 2026-10-08: a Play tap before hydration lost on a phone, a 429 that shows no wait time, focus on opening the expanded player, and "5 min" repeated in an episode's meta. Status unknown.
- Word-level focus in the transcript beyond the spoken-word fill, and a live measurement of time to first sound on Play (2026-10-08).
- The Apple touch icon's alpha: iOS composites it on black (DD-006).
- The played chip growing 11px with a mouse (state.md).
- A real-phone check of the bottom stack, and Safari 27 and WebKit for everything; neither has run.
- An emoji picker on the three group pages (AI, Design, Technology), asked as "edit emojis with a picker" (2026-10-21). Not a rule: a group is not a stored topic, so the picker has no record to save to. It needs a group emoji in the config and its read path, which waits on the owner's group override question (`state.md` Next 1; audit, 2026-10-22).
- Settings changes reaching pages other than Settings instantly. Today they take about a minute through commit and redeploy (D79).

## 9. Dreams

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

## 10. Skill enrichment queue

Lessons from this repo that belong in the `sk-design-engineering` plugin (`~/.agents/plugins/sk-design-engineering`, 1.4.2), checked against its skills on 2026-10-14:
- **Covered:** the skill already says it; leave it.
- **Partial:** add the missing half.
- **New:** the skill says nothing.

The rule text is written to paste, project-neutral. Coverage was judged by keyword search with a few files read, so confirm each before adding. Make the changes through `sk-skill-creator`, keep them lean, and do not duplicate what a reference already says.

### Proposed new reference files

| File | Holds | Why |
| :--- | :--- | :--- |
| `web-craft/references/audio-and-player.md` | One timeline and one transport, the AudioContext warm-up, the iOS unlock, the sound policy, interruptible sheet physics (one progress scalar, a velocity-carrying spring, flick and distance thresholds, slop anchoring), never caching media | Six rules cluster here; `dom-input.md`'s click-sound section would move into it |
| `web-craft/references/service-worker.md` | Stamped page copies, a background recheck, expiry on a version file, the import follower (backticks, depth), cache version bumps, never caching Range requests, one reload after a deploy | No service-worker guidance exists |
| `web-craft/references/webgl-ambient.md` | The four-step degrade, software-renderer detection, a jitter-tolerant frame cap, redraw on resize and theme, `isConnected` before mounting, the idle fallback, a contrast proof over every palette | No canvas or WebGL guidance exists |
| `build-design/references/feedback-and-copy.md` | Silence by default, affordance over instruction text, three- or four-word status, one message per live region, optimistic UI for slow work | Process and product-feel rules have no home |

### Rules

| # | Rule to add | Target | Status | Evidence here |
| :- | :--- | :--- | :--- | :--- |
| 1 | Before designing, name the reference product and copy its behaviour and its names; a destination is called what that product calls it. | build-design (process) | New | §1.1, §4 Archive |
| 2 | Treat every layout shift as a bug: fixed-width chips, a hidden widest-value copy under changing text, checks that take no room, `scrollbar-gutter: stable`, reserved room for notices. | web-craft `css-visual.md` | Partial | §3 Small component fixes |
| 3 | Confirm with the changed control, not a toast. Background saves are silent; status copy is three or four words and appears only when the user can act. | feedback-and-copy (new) | New | §1.3, D115 |
| 4 | Never write instruction text a control can make obvious. A glyph says what a press does; a control that cannot act stays visible, dimmed and named. | baseline-ui | Partial | §1.5 |
| 5 | Keep the accent fill for the one primary action and for current state; transport and secondary controls stay unfilled. Destructive red appears only inside the confirm. | refactoring-ui `systems.md` | Partial | §1.6 |
| 6 | One timeline and one transport on screen at a time; a second scrubber for the same audio is a defect. | audio-and-player (new) | New | §3 The player |
| 7 | Never set a small meta line directly above a headline; secondary text goes below with a full spacing step. | page-layout `grouping-and-alignment.md` | New | §1.9 |
| 8 | When one card has two targets (art plays, title opens), give them different hover states. | page-layout `spacing-and-adaptivity.md` | Partial | §1.5, D101 |
| 9 | Siblings in one group share one size, including a primary action placed among navigation items. | refactoring-ui | New | §1.6 |
| 10 | Popover and select lists: equal inner padding top and bottom, the page's surface, and a screenshot of the open state before shipping. | animation-rules `component-craft.md` | Partial | §3 Fields and selects |
| 11 | A segmented control's chosen item takes a full outline or container, never a bottom border alone; words never scale on press. | web-craft `components.md` | New | §3 Press, hover and focus |
| 12 | Measure perceived speed before optimising: move timings, LCP and time to a pressable control on a throttled phone profile, behind a gzip proxy if the test server does not compress. | web-craft `performance.md` | Partial | §2.9 |
| 13 | Astro's client router drops custom root attributes on swap; copy them onto `newDocument` in `astro:before-swap`. For moves under 50 ms, swap without a snapshot transition. | web-craft `dom-transitions.md` | Partial | §5 |
| 14 | Create the AudioContext on the first `pointerdown` or `keydown`, before a click needs it, and queue the first cue; construction can take over 200 ms on a phone. | audio-and-player (new) | Partial | §5 |
| 15 | WebGL effects: detect software renderers by name, cap frames at the interval minus a few ms, redraw on resize and theme change, check `isConnected` before mounting a lazily imported module, and fall back to `setTimeout` where `requestIdleCallback` is missing. | webgl-ambient (new) | New | §5, §3 Ambient light |
| 16 | A service worker that follows imports must match backtick-quoted dynamic imports; bump the cache version after any chunking change; never cache Range requests or media. | service-worker (new) | New | §5 |
| 17 | `[hidden]` loses to any author `display` rule; ship a global rule and a test. | web-craft `css-visual.md` | Partial | §5 |
| 18 | Headless Chrome has a minimum window width: capture phones with device emulation or a phone-width iframe, in both themes, with open and playing states. | web-craft-audit `browser-pass.md` | Partial | §2.4 |
| 19 | `:is()` takes the specificity of its highest argument and `:where()` is zero; order rules so specificity never descends. | web-craft `css-visual.md` | Partial | §5 |
| 20 | Compute a time zone's offset at an instant with Intl; never store or prerender it. | web-craft `dom-input.md` | New | §5 |
| 21 | Reduced motion is gentler, not zero: keep fade durations, zero only travel and scale. | animation-rules | Covered | §7.9 shows the gap in this repo |
| 22 | Prove contrast in code over every palette in both themes. Opacity-dimmed text fails; mark a locked or unavailable choice with a glyph and an edge, or do not draw it. | refactoring-ui `diagnose.md` | Partial | §3 Colour, §4 |
| 23 | resvg and other server SVG renderers ignore variable-font axes (ship static instances) and can crash on blur inside masks (use gradient masks). Compose a social card at its own size, never crop it. | web-craft `typography.md` | New | §3 Covers |
| 24 | iOS: `pointerdown` does not unlock audio. Also listen to `pointerup`, `touchend` and `click`, and set `navigator.audioSession.type = "playback"` where it exists. | audio-and-player (new) | New | §5 |
| 25 | Every enabled control makes a sound by kind through one delegated listener; hover, focus, scroll, typing and successful background saves are silent. Silence on a press reads as broken. | audio-and-player (new) | Partial | §3 Sound |
| 26 | A repeated ask is a hard requirement. Do not remove a control or delete content to simplify without asking; such removals tend to come back. | build-design (process) | New | §1 Repeat asks, §4 |
| 27 | Review loop: references first, screenshots at desktop and phone sizes in both themes, open states seen by eye, one PR per piece, and a list of what headless could not verify. | build-design (process) | Partial | §2 |
| 28 | Put colour transitions on the hover state only, so a theme switch never shows a mid-fade colour. | web-craft `color.md` | Partial | §3 Press, hover and focus |
| 29 | Grow a field on focus only with a fine pointer, so nothing moves under a tap. | web-craft `mobile.md` | Partial | §3 Fields and selects |
| 30 | A 44px target drawn with `::after` must subtract the control's border, or it lands short. | page-layout `spacing-and-adaptivity.md` | Partial | §3 Press, hover and focus |
| 31 | Changing digits sit over a hidden copy of the widest value and snap to device pixels, so they never shimmer. | web-craft `typography.md` | Partial | §3 Small component fixes |
| 32 | A sticky element centred with `translate: -50%` blurs on odd heights; use a measured `calc()` offset. | animation-rules `transforms-and-clip-path.md` | Partial | §3 Small component fixes |
| 33 | A popover placed once must close or re-place on scroll (capture, passive) and take its `transform-origin` from the trigger. | web-craft `dom-input.md` | Partial | §5 |
| 34 | When visual order differs from DOM order, change the DOM; `reading-flow` is Chromium only. | page-layout | Covered (add the `reading-flow` note) | §3 The player |
| 35 | Slow server work answers at once on the device (hide the deleted item, land on the list) while the job runs. | feedback-and-copy (new) | New | §3 Reading pages and the Library |
| 36 | Generative art is approved on a contact sheet at real size before it is wired: one gesture, one accent, no template repeated next to itself. | build-design (process) | New | §3 Covers, §4 |

### Gaps in the audit skill
`web-craft-audit` has no checks for layout shift, `[hidden]` overrides, unseen open states, or a duplicated timeline. Add them to its signals once rules 2, 6, 10 and 17 land.

## 11. Phone patterns

Read before any UI that a phone shows (the default: every browser test runs on the phone first). Each is a rule the owner set or confirmed; the date or decision is where it came from.

1. **Lists open as bottom sheets, never as popovers** (D167). Under 40rem a select's drawn list, the searchable picker, the multi-select and the More menu are sheets: the raised surface, the sheet radius on the top corners only, a scrim, a slide up in 300 ms and down in 220 (`--duration-sheet-*`, `--ease-drawer`), at most 70dvh tall, padding that clears the safe area at the bottom. A tap outside closes; where the sheet has a head, a pull closes it (`heroMenu.ts`). A popover's backdrop lets a tap through to the page, so a scrim never hides a control a reader could press by accident on the way out.
2. **Marks trail, identity leads.** A check, a chevron or a checkbox sits at the end of a row; an emoji, a favicon or a letter tile leads it (2026-10-23, the Listen in sheet). In a sheet the words come first and the check last, as a phone's own lists do.
3. **One control, one shape** (D167). Chips, select chips, select values, segmented controls and the search field are pills on every page and in every card; form text fields are 8px; a card's row tiles and buttons are concentric with the card. A control that looks different in one place is a bug, not a variant.
4. **Edges line up with the search field.** A row that shares a column with the search field sits its emoji and its chevron 16px in, the field's own padding, so they line up with the field's glyph and its clear button (2026-10-23).
5. **No tap flash, every control shows its own press.** `foundations.css` clears the highlight on buttons, links that act, labels, selects and inputs; the press is a state layer (8% hover, 12% press) on the control's own fill. A flash on one control and not its neighbour is the first thing the owner sees.
6. **Targets.** 44px for every control, 48 for a field, 56 for a one-line row, 64 to 72 for two lines; a 36px chip gets its target from an `::after`. A sticky bar never covers a target at rest (`a11y.spec.ts`, axe).
7. **The thumb's reach.** Every row's actions live in a dots menu at its end (a bottom sheet on a phone), never in a row of icon buttons. The one primary action floats bottom-end and folds to its glyph while reading; the navigation is a bottom bar; a toast sits above the bar and the docked player; sheets rise from the bottom; the app bar carries only Back and the wordmark. Nothing a reader needs often sits at the top.
8. **Swipe and pull.** A toast swipes away sideways (a dismissal, never an Undo: `Toaster.tsx`); a queue row swipes left to leave and moves by a long press (the browser's drag and drop, the one way a long press lifts a row while the list still scrolls); a menu sheet pulls closed; the player pulls down. A short gesture springs back to the same box, and a browser test compares the box to itself, never to a number.
9. **Nothing moves under a finger.** A field grows on focus only with a fine pointer; the picker does not focus its search on a coarse pointer, so the keyboard never covers the list; inputs are 16px so iOS never zooms; fixed elements are held by their bottom edge, so the address bar moves them in one frame.
10. **Widths.** Under 40rem is a phone (sheets, one column, the bottom bar); under 64rem there is no side column (the floating action, the sticky search). Test at 390 by 844 (Pixel 7) and 1280 by 800, light and dark, and screenshot every open state before a PR.

## Keeping this file

When an ask changes the look or feel:
- Add a row to section 3 with its decision number, or the chat date if there is no decision.
- Move an item out of section 8 once it is done.
- Strike a dream once it is built or rejected.
- Add a lesson that would help any project to section 10, and strike it there once the skill carries it.

Do not restate a decision's reasoning here; link it.
