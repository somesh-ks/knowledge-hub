# Design engineering ledger

Every design-engineering tweak and visual change asked for on this project, what was built, what the code does as a result, where it falls short, and what could come next. Written 2026-10-14; the chat pass added sections 2, 5 and 10 and dated quotes throughout.

Sources:
- `docs/decisions/` D1 to D115.
- The notes in `history/`, including the two 2026-10-11 audits folded into them.
- `design/design-spec.md`, `design/sound-design.md` and `plan/vision.md`.
- `learnings.md`.
- Every local Claude Code session on this repo, 2026-10-05 to 2026-10-14 (14 transcripts: the owner's messages, the replies and the compaction summaries), and the cloud session of 2026-10-14.
- A read of `apps/web/src`, `packages/` and `tokens/`. File and line references were checked against `main` at `8549f27`.

Each fact links to its decision rather than restating it; if this file and a decision disagree, the decision wins. A date in brackets, such as (2026-10-08), marks an ask that lives only in a chat.

**For an agent starting UI work:** read this file (sections 1, 2, 4 and 11), then only the surface file you are touching from the table in section 3. Read `ledger/code.md` before you build something the owner may already have asked for; leave `ledger/ideas.md` unless you are planning.

**For enriching the design-engineering skill:** `ledger/ideas.md` (section 10) lists each lesson with its target skill, whether the skill already covers it, and the rule text to add.

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
   - Colour is information, not decoration. The bar's play "doesnt need a blue background... catches unnecessary attention", and the bar lost its hover tint (2026-10-08). Delete is red only inside its confirm dialog (`episode-actions.css` `.confirm-delete`).
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

One file per surface in [ledger/](ledger/README.md); open only the one you are changing.

| File | Surface |
| --- | --- |
| [look-tokens-type.md](ledger/look-tokens-type.md) | Hand-written CSS, tokens, type, radii, the 8pt grid |
| [colour-theme-art.md](ledger/colour-theme-art.md) | Colour, light and dark, covers and art |
| [motion-navigation.md](ledger/motion-navigation.md) | Transitions, the nav pill, page and cover motion |
| [player.md](ledger/player.md) | The mini player, the full player, the queue, the sheets |
| [bottom-stack-phone.md](ledger/bottom-stack-phone.md) | Nav, mini player and sheets stacked at the foot of a phone |
| [components.md](ledger/components.md) | Buttons, chips, selects, dialogs, cards, one fix at a time |
| [reading-library.md](ledger/reading-library.md) | Digest and topic pages, the Library list |
| [settings-forms.md](ledger/settings-forms.md) | Settings, Preferences, forms and creation flows |
| [sound-accessibility.md](ledger/sound-accessibility.md) | Sound cues, haptics, reduced motion, focus, contrast |
| [code.md](ledger/code.md) | Sections 5 to 8: hacks and mechanisms, what the code does well, gaps in the code, owner asks with no record of being done |
| [ideas.md](ledger/ideas.md) | Sections 9 and 10: dreams, and the skill enrichment queue |

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

## 11. Phone patterns

Read before any UI that a phone shows (the default: every browser test runs on the phone first). Each is a rule the owner set or confirmed; the date or decision is where it came from.

1. **Lists open as bottom sheets, never as popovers** (D167). Under 40rem a select's drawn list, the searchable picker, the multi-select and the More menu are sheets: the raised surface, the sheet radius on the top corners only, a scrim, a slide up in 300 ms and down in 220 (`--duration-sheet-*`, `--ease-drawer`), at most 70dvh tall, padding that clears the safe area at the bottom. A tap outside closes; where the sheet has a head, a pull closes it (`heroMenu.ts`). A popover's backdrop lets a tap through to the page, so a scrim never hides a control a reader could press by accident on the way out.
2. **Marks trail, identity leads.** A check, a chevron or a checkbox sits at the end of a row; an emoji, a favicon or a letter tile leads it (2026-10-23, the Listen in sheet). In a sheet the words come first and the check last, as a phone's own lists do.
3. **One control, one shape** (D167). Chips, select chips, select values, segmented controls and the search field are pills on every page and in every card, and so are form text fields and a card's buttons (D186; a multi-line field 24px); a card's row tiles are concentric with the card. Words and bare glyphs align by their ink, filled and outlined controls by their edge; a row-end glyph pulls out by its measured `--ink-end` (D187). A control that looks different in one place is a bug, not a variant.
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
