# Reading pages and the Library

Ledger section 3, one surface. Read [the core](../design-engineering-ledger.md) first (taste in section 1, how to work in section 2, the phone in section 11). Each row: the ask, what was built, the decision; if a decision and a row disagree, the decision wins.

## Reading pages and the Library
- **Hero.**
  - One filled action, which goes tonal while playing and shows the time left (D77, D88).
  - Share sits beside Play as a tonal pill at Play's height, its own width, with a 44px hit area (`.hero-share`, hero.css; owner, 2026-10-24, D153). Not in the More menu, which keeps Stop sharing. Then (owner, 2026-10-25): Share opens a small dialog like Drive's, the address in a read-only field, Copy link (reads "Copied" for a moment) and Close, instead of the native share or copy prompt ("have a simple dialog UI with the url in a textbox"); a centred dialog at every width (`create-sheet.css .share-dialog`, `shareDialog.ts`; on a phone the create sheet's header hid Close until the dialog joined its exception, `create-sheet.css`). Stop sharing left the hero menu ("shouldn't be here") and lives in the Library row's menu only.
  - One hero layout for any title length. The hero text fills the cover's height; a gap under it came from a `1fr` middle row with `align-self: end` actions, fixed with an 8rem cover (2026-10-12). On a phone the stacked cover is `clamp(8rem, 36vw, 10rem)`, never smaller than the wide layout's (2026-10-23).
  - Sections separated by space alone. Hairlines, where they exist, run inside the column (2026-10-08).
  - The reading column is centred in the pane at every width, from 80rem too: the old reserved contents track left it 96px from the side navigation and 384px from the window's edge (owner, 2026-10-29, D229). The list takes the right margin's room.
  - "Contents" sits beside the episode, sticky at the vertical centre (2026-10-08, 2026-10-12). "N min listen" went; Highlights replaced the script on the page (2026-10-08).
- **Play chip.**
  - One width; Played shows Play again only under a mouse or focus (D106, #116).
  - Its state machine: idle, current, played, preparing, error, unavailable.
- **A story.** The publisher above the headline, muted, whole and underlined with no link glyph (D161; owner, 2026-10-24); no Why line (owner, 2026-10-24); under the text, 16px down, one row, the Play chip and the controls at its end, never wrapping (owner, 2026-10-22 and 2026-10-23). Every quiet line of facts takes one separator: a centred dot in a 12px box (`--meta-dot`, 2026-10-22). Section tabs and the contents column only from two sections, on a briefing and an episode alike, whose highlights take their briefings' sections and whose facts read "Discussion · 5 stories" (owner, 2026-10-24).
- **Library.**
  - A cover grid with one facts line per card (D78).
  - Search, filter and sort live in the address.
  - Search matches word starts (D95), with excerpts that start at the hit.
  - Played and progress marks agree across every surface (D97). A card's progress is its `::before`, because `::after` is the press layer (`library.css:72`).
  - `content-visibility: auto` on cards.
  - Titles clamp to two lines (`library.css:98`) and generated names stay short ("AI Products, Design and 2 more"), with a tooltip for a truncated title under a mouse (2026-10-08).
  - Filters All, Daily, Weekly and Custom; Oldest first reverses same-day cards too; the count reads "1 of 5 results"; a touch-only Clear text button (2026-10-08).
  - Deleting an episode hides it at once on this device and lands on the Library while the 2 to 3 minute workflow runs (2026-10-08).
  - A three-dots menu per row (Download, Add to queue, Regenerate, Share, Delete); a downloaded row has a filled check-circle with a hidden "Downloaded" (D127).
  - A podcast page's More menu offers Download and Add to queue too, in the row menu's order, so one podcast has the same actions in both places (owner, 2026-10-28; D214). Share stays beside Play.
  - Owner pass of 2026-10-25: a story's source is a link, not a button: no filled hover, an underline that draws in on hover, a colour change on press (`primitives.css .source-link`; "this shouldn't be a button with hover state, rather a link button with underline animation"). The contents rail marks the section whose title has reached a reading line a third of the way down the space under the sticky chrome, where it lit late ("highlighted with a delay"; `briefingPage.ts`). A Library cover no longer scales on press, and the card link suppresses the tap highlight ("remove the black highlight when clicked"; `library.css`, `foundations.css`). "The whole stack shrinks by width" when a menu opens was not reproduced at 390 or 1280 with real scrollbars; a `@both` guard in `libraryMenu.spec.ts` holds the stack's box to itself. A phone has no sort, and the chips (16px side padding) share a line with the view switch, scrolling at 360px (2026-10-21).
